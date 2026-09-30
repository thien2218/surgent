import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_CHECKPOINT_KEY, findCheckpoint, pruneCheckpointStore, readCheckpointStore, shouldOfferRestore, writeCheckpointStore } from "../../../src/checkpoint/store.js";
import { cleanupWorkspace } from "../../helpers/cleanup.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, readFile: vi.fn(filesystem.readFile), writeFile: vi.fn(filesystem.writeFile) };
});
afterEach(async () => {
  const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(readFile).mockReset().mockImplementation(filesystem.readFile);
  vi.mocked(writeFile).mockReset().mockImplementation(filesystem.writeFile);
  vi.restoreAllMocks();
});

const firstTree = "a".repeat(40);
const secondTree = "b".repeat(64);

function context(parents: Record<string, string | null> = {}) {
  return {
    sessionManager: {
      getEntry: vi.fn((entryId: string) => entryId in parents ? { id: entryId, parentId: parents[entryId] } : undefined),
    },
  } as unknown as ExtensionContext;
}

async function storeFile(contents?: unknown) {
  const workspace = await cleanupWorkspace();
  const path = join(workspace.cwd, "entries.json");
  if (contents !== undefined) await writeFile(path, JSON.stringify(contents));
  return path;
}

describe("checkpoint persistence", () => {
  it("returns an empty store for a missing file", async () => {
    expect(await readCheckpointStore(await storeFile())).toEqual({});
  });

  it("trims SHA-1 and SHA-256 trees and discards malformed nested values", async () => {
    const path = await storeFile({
      valid: { short: ` ${firstTree}\n`, long: secondTree.toUpperCase(), wrongType: 42, nonHex: "z".repeat(40), empty: "" },
      nullSession: null, listSession: [], stringSession: "bad",
    });
    expect(await readCheckpointStore(path)).toEqual({ valid: { short: firstTree, long: secondTree.toUpperCase() } });
  });

  it.each([39, 41, 48, 63, 65])("rejects a %i-character tree instead of retaining an unusable ref", async (length) => {
    expect(await readCheckpointStore(await storeFile({ session: { entry: "a".repeat(length) } }))).toEqual({ session: {} });
  });

  it.each([null, [], "text", 42])("rejects invalid store root %j", async (root) => {
    await expect(readCheckpointStore(await storeFile(root))).rejects.toThrow("Expected JSON object");
  });

  it("does not overwrite malformed JSON during a save", async () => {
    const path = await storeFile();
    await writeFile(path, "{broken");
    await expect(writeCheckpointStore(path, "session", new Map([["entry", firstTree]]))).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{broken");
  });

  it("round-trips changes while preserving other sessions and creates parent directories", async () => {
    const workspace = await cleanupWorkspace();
    const path = join(workspace.cwd, "nested", "entries.json");
    await writeCheckpointStore(path, "first", new Map([["entry", firstTree]]));
    await writeCheckpointStore(path, "second", new Map([[BASE_CHECKPOINT_KEY, secondTree]]));
    expect(await readCheckpointStore(path)).toEqual({ first: { entry: firstTree }, second: { [BASE_CHECKPOINT_KEY]: secondTree } });
    await writeCheckpointStore(path, "first", new Map());
    expect(await readCheckpointStore(path)).toEqual({ second: { [BASE_CHECKPOINT_KEY]: secondTree } });
    await writeCheckpointStore(path, "second", new Map());
    expect(await readCheckpointStore(path)).toEqual({});
  });

  it("propagates read errors instead of replacing unavailable state", async () => {
    const path = await storeFile({ saved: { entry: firstTree } });
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("read denied"), { code: "EACCES" }));
    await expect(writeCheckpointStore(path, "new", new Map())).rejects.toThrow("read denied");
    expect(await readCheckpointStore(path)).toEqual({ saved: { entry: firstTree } });
  });

  it("propagates failed writes without reporting a successful save", async () => {
    const path = await storeFile({ saved: { entry: firstTree } });
    vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    await expect(writeCheckpointStore(path, "new", new Map([["entry", secondTree]]))).rejects.toThrow("disk full");
    expect(await readCheckpointStore(path)).toEqual({ saved: { entry: firstTree } });
  });
});

describe("checkpoint pruning policy", () => {
  it("retains protected UUIDv7 and non-v7 sessions without rewriting unchanged state", async () => {
    const live = "01900000-0000-7000-8000-000000000001";
    const path = await storeFile({ [live]: { entry: firstTree }, legacy: { entry: secondTree } });
    const before = await readFile(path, "utf8");
    const writes = vi.mocked(writeFile).mock.calls.length;
    expect(await pruneCheckpointStore(path, new Set([live]))).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(vi.mocked(writeFile).mock.calls.length).toBe(writes);
  });
  // Shared-tree removal and failed persistence are covered by integration/cleanup/checkpoint.test.ts.
});

describe("checkpoint ancestry", () => {
  it("chooses the exact entry then the closest ancestor, not a sibling branch", () => {
    const ctx = context({ leaf: "parent", parent: "root", root: null, sibling: "root" });
    const checkpoints = new Map([[BASE_CHECKPOINT_KEY, "base"], ["root", "old"], ["parent", "near"], ["sibling", "other"]]);
    expect(findCheckpoint("leaf", ctx, checkpoints)).toBe("near");
    checkpoints.set("leaf", "exact");
    expect(findCheckpoint("leaf", ctx, checkpoints)).toBe("exact");
  });

  it.each([null, "missing", "root"])("falls back to base for %s without a mapped ancestor", (entryId) => {
    expect(findCheckpoint(entryId, context({ root: null }), new Map([[BASE_CHECKPOINT_KEY, firstTree]]))).toBe(firstTree);
    expect(findCheckpoint(entryId, context({ root: null }), new Map())).toBeUndefined();
  });

  it.each([
    { target: undefined, current: firstTree, expected: { shouldRestore: false } },
    { target: firstTree, current: firstTree, expected: { shouldRestore: false } },
    { target: firstTree, current: secondTree, expected: { shouldRestore: true, tree: firstTree } },
    { target: firstTree, current: undefined, expected: { shouldRestore: true, tree: firstTree } },
  ])("offers restore only for a known, different target: $target / $current", ({ target, current, expected }) => {
    const checkpoints = new Map<string, string>();
    if (target) checkpoints.set("target", target);
    if (current) checkpoints.set("current", current);
    expect(shouldOfferRestore("target", "current", context(), checkpoints)).toEqual(expected);
  });

  it("compares resolved ancestors and the base for a null current leaf", () => {
    const checkpoints = new Map([[BASE_CHECKPOINT_KEY, firstTree], ["parent", firstTree]]);
    expect(shouldOfferRestore("leaf", null, context({ leaf: "parent" }), checkpoints)).toEqual({ shouldRestore: false });
  });
});
