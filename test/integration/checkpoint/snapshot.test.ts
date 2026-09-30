import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chmod, lstat, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gcCheckpointRepo, openCheckpointRepo } from "../../../src/checkpoint/git.js";
import { createSnapshot, restoreSnapshot, retainSnapshot } from "../../../src/checkpoint/snapshot.js";
import { openCheckpointWorkspace } from "../../helpers/checkpoint.js";
import { recordExtension } from "../../helpers/extension.js";

async function snapshot(workspace: Awaited<ReturnType<typeof openCheckpointWorkspace>>) {
  const tree = await createSnapshot(workspace.api, workspace.repo);
  if (!tree) throw new Error("Failed to snapshot disposable workspace");
  return tree;
}

describe("checkpoint staging and restore", () => {
  it("captures edits, deletions, renames and new files and restores earlier content", async () => {
    const workspace = await openCheckpointWorkspace();
    for (const name of ["edited", "deleted", "renamed"]) await writeFile(join(workspace.cwd, name), `old ${name}`);
    const before = await snapshot(workspace);
    expect(await snapshot(workspace)).toBe(before);
    await writeFile(join(workspace.cwd, "edited"), "new");
    await rm(join(workspace.cwd, "deleted"));
    await rename(join(workspace.cwd, "renamed"), join(workspace.cwd, "moved"));
    await writeFile(join(workspace.cwd, "added"), "added");
    const after = await snapshot(workspace);
    expect(after).not.toBe(before);
    expect(workspace.checkpointGit(["ls-tree", "--name-only", after]).split("\n")).toEqual(["added", "edited", "moved"]);
    expect((await restoreSnapshot(workspace.api, workspace.repo, before)).code).toBe(0);
    for (const name of ["edited", "deleted", "renamed"]) expect(await readFile(join(workspace.cwd, name), "utf8")).toBe(`old ${name}`);
    for (const name of ["added", "moved"]) await expect(readFile(join(workspace.cwd, name))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await restoreSnapshot(workspace.api, workspace.repo, after)).code).toBe(0);
    expect(await readFile(join(workspace.cwd, "edited"), "utf8")).toBe("new");
  });

  it("excludes ignored and oversized untracked files but retains tracked ones", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "small");
    await snapshot(workspace);
    await writeFile(join(workspace.cwd, ".gitignore"), "ignored\ntracked\n");
    await writeFile(join(workspace.cwd, ".git", "info", "exclude"), "local-secret\n");
    await openCheckpointRepo(workspace.api, workspace.cwd);
    await writeFile(join(workspace.cwd, "ignored"), "not captured");
    await writeFile(join(workspace.cwd, "local-secret"), "fake private data");
    for (const [name, size] of [["below", 2 * 1024 * 1024 - 1], ["exact", 2 * 1024 * 1024], ["above", 2 * 1024 * 1024 + 1], ["tracked", 2 * 1024 * 1024 + 1]] as const) {
      await writeFile(join(workspace.cwd, name), Buffer.alloc(size, 120));
    }
    const tree = await snapshot(workspace);
    expect(workspace.checkpointGit(["ls-tree", "--name-only", tree]).split("\n")).toEqual([".gitignore", "below", "exact", "tracked"]);
    expect(Number(workspace.checkpointGit(["cat-file", "-s", `${tree}:tracked`]))).toBe(2 * 1024 * 1024 + 1);
  });

  it("stages literal filenames across multiple batches", async () => {
    const workspace = await openCheckpointWorkspace();
    const names = ["space name", "unicode-雪", "-leading", "[glob]", ":(exclude)victim", "line\nbreak", ...Array.from({ length: 105 }, (_, index) => `file-${index}`)];
    for (const name of names) await writeFile(join(workspace.cwd, name), name);
    const tree = await snapshot(workspace);
    expect(workspace.checkpointGit(["ls-tree", "-z", "--name-only", tree]).split("\0").filter(Boolean).sort()).toEqual([...names].sort());
    expect(workspace.checkpointGit(["show", `${tree}::(exclude)victim`])).toBe(":(exclude)victim");
  });

  it("restores symlink targets and executable bits without following links", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "script"), "#!/bin/sh\nexit 0\n");
    await chmod(join(workspace.cwd, "script"), 0o755);
    await symlink("script", join(workspace.cwd, "link"));
    const before = await snapshot(workspace);
    await rm(join(workspace.cwd, "link"));
    await symlink("missing", join(workspace.cwd, "link"));
    await chmod(join(workspace.cwd, "script"), 0o644);
    await snapshot(workspace);
    expect((await restoreSnapshot(workspace.api, workspace.repo, before)).code).toBe(0);
    expect(await readlink(join(workspace.cwd, "link"))).toBe("script");
    expect((await lstat(join(workspace.cwd, "script"))).mode & 0o111).toBe(0o111);
  });

  it("preserves CRLF bytes when the source repository enables autocrlf", async () => {
    const workspace = await openCheckpointWorkspace();
    workspace.git(workspace.cwd, ["config", "core.autocrlf", "true"]);
    const bytes = Buffer.from("first\r\nsecond\r\n");
    await writeFile(join(workspace.cwd, "windows.txt"), bytes);
    const before = await snapshot(workspace);
    await writeFile(join(workspace.cwd, "windows.txt"), "changed\n");
    await snapshot(workspace);
    expect((await restoreSnapshot(workspace.api, workspace.repo, before)).code).toBe(0);
    expect(await readFile(join(workspace.cwd, "windows.txt"))).toEqual(bytes);
  });

  it("leaves source index, HEAD and branch untouched across snapshot and restore", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "committed");
    workspace.git(workspace.cwd, ["add", "."]);
    workspace.git(workspace.cwd, ["-c", "user.name=Checkpoint Test", "-c", "user.email=checkpoint@example.invalid", "commit", "--quiet", "-m", "fixture"]);
    await writeFile(join(workspace.cwd, "tracked"), "staged");
    workspace.git(workspace.cwd, ["add", "tracked"]);
    await writeFile(join(workspace.cwd, "tracked"), "unstaged");
    const index = await readFile(join(workspace.cwd, ".git", "index"));
    const head = workspace.git(workspace.cwd, ["rev-parse", "HEAD"]);
    const branch = workspace.git(workspace.cwd, ["symbolic-ref", "HEAD"]);
    const before = await snapshot(workspace);
    await writeFile(join(workspace.cwd, "tracked"), "later");
    await snapshot(workspace);
    expect((await restoreSnapshot(workspace.api, workspace.repo, before)).code).toBe(0);
    expect(await readFile(join(workspace.cwd, "tracked"), "utf8")).toBe("unstaged");
    expect(await readFile(join(workspace.cwd, ".git", "index"))).toEqual(index);
    expect(workspace.git(workspace.cwd, ["rev-parse", "HEAD"])).toBe(head);
    expect(workspace.git(workspace.cwd, ["symbolic-ref", "HEAD"])).toBe(branch);
  });

  it("preserves unrelated untracked and ignored files during restore", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "before");
    await writeFile(join(workspace.cwd, ".gitignore"), "ignored\n");
    const before = await snapshot(workspace);
    await writeFile(join(workspace.cwd, "tracked"), "after");
    await snapshot(workspace);
    await writeFile(join(workspace.cwd, "untracked"), "keep untracked");
    await writeFile(join(workspace.cwd, "ignored"), "keep ignored");
    expect((await restoreSnapshot(workspace.api, workspace.repo, before)).code).toBe(0);
    expect(await readFile(join(workspace.cwd, "untracked"), "utf8")).toBe("keep untracked");
    expect(await readFile(join(workspace.cwd, "ignored"), "utf8")).toBe("keep ignored");
  });

  it("retains snapshots through reopen and actual Git pruning", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "retained");
    const before = await snapshot(workspace);
    expect(await retainSnapshot(workspace.api, workspace.repo, before)).toBe(true);
    expect(await retainSnapshot(workspace.api, workspace.repo, before)).toBe(true);
    await writeFile(join(workspace.cwd, "tracked"), "later");
    await snapshot(workspace);
    workspace.checkpointGit(["gc", "--prune=now"]);
    expect((await gcCheckpointRepo(workspace.api, workspace.repo)).code).toBe(0);
    const reopened = await openCheckpointRepo(workspace.api, workspace.cwd);
    expect((await restoreSnapshot(workspace.api, reopened!, before)).code).toBe(0);
    expect(await readFile(join(workspace.cwd, "tracked"), "utf8")).toBe("retained");
  });

  it("does not mutate files when restoring a nonexistent tree", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "safe");
    await snapshot(workspace);
    expect((await restoreSnapshot(workspace.api, workspace.repo, "0".repeat(40))).code).not.toBe(0);
    expect(await readFile(join(workspace.cwd, "tracked"), "utf8")).toBe("safe");
  });

  it("does not report a snapshot when staging fails", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "new"), "content");
    const exec: ExtensionAPI["exec"] = (command, args, options) => args.includes("add")
      ? Promise.resolve({ code: 1, stderr: "index locked", stdout: "", killed: false })
      : workspace.exec(command, args, options);
    expect(await createSnapshot(recordExtension({ exec }).api, workspace.repo)).toBeUndefined();
    expect(await readFile(join(workspace.cwd, "new"), "utf8")).toBe("content");
  });
});
