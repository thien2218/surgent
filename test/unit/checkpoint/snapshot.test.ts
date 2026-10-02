import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSnapshot, retainSnapshot, restoreSnapshot } from "../../../src/checkpoint/snapshot.js";
import { runCheckpointGit } from "../../../src/checkpoint/git.js";
import { recordExtension } from "../../helpers/extension.js";

const repo = { projectRoot: "/workspace", directory: "/checkpoints" };

function execution(failure?: string, stdout = "") {
  const exec = vi.fn<ExtensionAPI["exec"]>(async (_command, args) => ({
    stdout: args.includes("write-tree") ? stdout : "",
    stderr: args.includes(failure ?? "never") ? "git failed" : "",
    code: args.includes(failure ?? "never") ? 1 : 0,
    killed: false,
  }));
  return recordExtension({ exec }).api;
}

describe("snapshot Git boundary", () => {
  it.each([40, 64])("accepts a trimmed %i-character tree ID", async (length) => {
    expect(await createSnapshot(execution(undefined, ` ${"A".repeat(length)}\n`), repo)).toBe("A".repeat(length));
  });

  it.each([0, 39, 41, 48, 63, 65])("rejects a %i-character tree ID", async (length) => {
    expect(await createSnapshot(execution(undefined, "a".repeat(length)), repo)).toBeUndefined();
  });

  it.each(["z".repeat(40), `${"a".repeat(40)}\n${"b".repeat(40)}`])("rejects malformed tree output", async (output) => {
    expect(await createSnapshot(execution(undefined, output), repo)).toBeUndefined();
  });

  it.each(["diff-files", "ls-files", "write-tree"])("returns no snapshot when %s fails", async (command) => {
    expect(await createSnapshot(execution(command, "a".repeat(40)), repo)).toBeUndefined();
  });

  it("reports failed ref retention", async () => {
    expect(await retainSnapshot(execution("update-ref"), repo, "a".repeat(40))).toBe(false);
  });

  it("returns restore failure details for the caller to cancel navigation", async () => {
    expect(await restoreSnapshot(execution("read-tree"), repo, "a".repeat(40))).toMatchObject({ code: 1, stderr: "git failed" });
  });

  it("returns garbage collection failures instead of reporting success", async () => {
    expect(await runCheckpointGit(execution("gc"), repo, ["gc", "--auto"])).toMatchObject({ code: 1, stderr: "git failed" });
  });
});
