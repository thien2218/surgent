import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupCheckpoints } from "../../../src/cleanup/checkpoint.js";
import { checkpointWorkspace, cleanupWorkspace } from "../../helpers/cleanup.js";
import { recordExtension } from "../../helpers/extension.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, writeFile: vi.fn(filesystem.writeFile) };
});

afterEach(() => vi.mocked(writeFile).mockReset());

const liveId = "01900000-0000-7000-8000-000000000001";
const staleId = "01900000-0000-7000-8000-000000000002";

describe("checkpoint cleanup", () => {
  it("removes stale entries and only unreferenced checkpoint refs", async () => {
    const workspace = await checkpointWorkspace();
    const shared = workspace.tree("shared");
    const stale = workspace.tree("stale");
    const legacy = workspace.tree("legacy");
    const unrelated = workspace.tree("untracked");
    await writeFile(workspace.storePath, JSON.stringify({
      [liveId]: { entry: shared },
      [staleId]: { shared, first: stale, duplicate: stale },
      legacy: { entry: legacy },
    }));

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set([liveId]));

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({
      [liveId]: { entry: shared }, legacy: { entry: legacy },
    });
    expect(workspace.refs()).toEqual([shared, legacy, unrelated].sort());
    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set([liveId]));
    expect(workspace.refs()).toEqual([shared, legacy, unrelated].sort());
  });

  it("does not rewrite stores when every session is retained", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("live");
    const original = JSON.stringify({ [liveId]: { entry: tree } });
    await writeFile(workspace.storePath, original);

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set([liveId]));

    expect(await readFile(workspace.storePath, "utf8")).toBe(original);
    expect(workspace.refs()).toEqual([tree]);
  });

  it("does not create a missing store or remove untracked refs", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("untracked");

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set());

    await expect(readFile(workspace.storePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(workspace.refs()).toEqual([tree]);
  });

  it("does nothing outside a Git repository", async () => {
    const workspace = await cleanupWorkspace();
    const api = recordExtension({
      exec: async () => ({ stdout: "", stderr: "not a repository", code: 128, killed: false }),
    }).api;

    await expect(cleanupCheckpoints(api, workspace.cwd, new Set())).resolves.toBeUndefined();
    await expect(readFile(join(workspace.home, ".pi", "agent", "checkpoints"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prunes stale entries when the checkpoint Git directory is missing", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("stale");
    await writeFile(workspace.storePath, JSON.stringify({ [staleId]: { entry: tree } }));
    await rm(join(workspace.directory, ".git"), { recursive: true });

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set());

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("accepts already-missing checkpoint refs", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("stale");
    await writeFile(workspace.storePath, JSON.stringify({ [staleId]: { entry: tree } }));
    workspace.git(workspace.directory, ["update-ref", "-d", `refs/surgent/checkpoints/${tree}`]);

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set());

    expect(workspace.refs()).toEqual([]);
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it.each(["{broken", "[]", "null"])("preserves unreadable store %s and its refs", async (content) => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("protected");
    await writeFile(workspace.storePath, content);

    await expect(cleanupCheckpoints(workspace.api, workspace.cwd, new Set())).rejects.toThrow();

    expect(await readFile(workspace.storePath, "utf8")).toBe(content);
    expect(workspace.refs()).toEqual([tree]);
  });

  it("ignores invalid stored hashes instead of treating them as ref names", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("protected");
    await writeFile(workspace.storePath, JSON.stringify({
      [staleId]: { invalid: `refs/surgent/checkpoints/${tree}`, missing: null },
    }));
    const exec = vi.fn(workspace.exec);

    await cleanupCheckpoints(recordExtension({ exec }).api, workspace.cwd, new Set());

    expect(exec.mock.calls.some(([, args]) => args.includes("update-ref"))).toBe(false);
    expect(workspace.refs()).toEqual([tree]);
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("leaves the original store and refs intact when pruning cannot be persisted", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("protected");
    const original = JSON.stringify({ [staleId]: { entry: tree } });
    await writeFile(workspace.storePath, original);
    vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error("Disk full"), { code: "ENOSPC" }));

    await expect(cleanupCheckpoints(workspace.api, workspace.cwd, new Set())).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await readFile(workspace.storePath, "utf8")).toBe(original);
    expect(workspace.refs()).toEqual([tree]);
  });

  it("finishes store pruning even when Git refuses to delete a locked ref", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("locked");
    await writeFile(workspace.storePath, JSON.stringify({ [staleId]: { entry: tree } }));
    await writeFile(join(workspace.directory, ".git", "refs", "surgent", "checkpoints", `${tree}.lock`), "");

    await cleanupCheckpoints(workspace.api, workspace.cwd, new Set());

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
    expect(workspace.refs()).toEqual([tree]);
  });

  it("leaves refs intact when the store cannot be read", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("stale");
    await writeFile(workspace.storePath, JSON.stringify({ [staleId]: { entry: tree } }));
    await rm(workspace.storePath);
    await mkdir(workspace.storePath);

    await expect(cleanupCheckpoints(workspace.api, workspace.cwd, new Set())).rejects.toThrow();

    expect(workspace.refs()).toEqual([tree]);
  });
});
