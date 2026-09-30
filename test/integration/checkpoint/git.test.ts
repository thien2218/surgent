import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCheckpointRepo, openCheckpointRepo } from "../../../src/checkpoint/git.js";
import { createSnapshot } from "../../../src/checkpoint/snapshot.js";
import { checkpointWorkspace } from "../../helpers/cleanup.js";
import { openCheckpointWorkspace } from "../../helpers/checkpoint.js";
import { recordExtension } from "../../helpers/extension.js";

const commitArgs = ["-c", "user.name=Checkpoint Test", "-c", "user.email=checkpoint@example.invalid", "commit", "--quiet", "-m", "fixture"];

describe("checkpoint repository", () => {
  it("disables checkpoints outside Git without creating storage", async () => {
    const workspace = await checkpointWorkspace();
    await rm(join(workspace.cwd, ".git"), { recursive: true });
    expect(await openCheckpointRepo(workspace.api, workspace.cwd)).toBeUndefined();
  });

  it("resolves nested paths and reuses initialized state", async () => {
    const workspace = await openCheckpointWorkspace();
    const nested = join(workspace.cwd, "nested");
    await mkdir(nested);
    await writeFile(workspace.storePath, "saved");
    expect(await openCheckpointRepo(workspace.api, nested)).toEqual(workspace.repo);
    expect(await readFile(workspace.storePath, "utf8")).toBe("saved");
  });

  it("reinitializes a checkpoint repository from a different source identity", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(workspace.storePath, "stale");
    workspace.checkpointGit(["config", "surgent.checkpointSource", join(workspace.root, "old-source")]);
    expect(await openCheckpointRepo(workspace.api, workspace.cwd)).toEqual(workspace.repo);
    await expect(readFile(workspace.storePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await createSnapshot(workspace.api, workspace.repo)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("isolates independent projects and linked worktrees", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "main");
    workspace.git(workspace.cwd, ["add", "."]);
    workspace.git(workspace.cwd, commitArgs);
    const linked = join(workspace.root, "linked");
    workspace.git(workspace.cwd, ["worktree", "add", "--quiet", "-b", "linked", linked]);
    const linkedRepo = await openCheckpointRepo(workspace.api, linked);
    expect(linkedRepo?.directory).not.toBe(workspace.repo.directory);
    expect(linkedRepo?.projectRoot).toBe(linked);
    expect(await readFile(join(linkedRepo!.directory, ".git", "objects", "info", "alternates"), "utf8"))
      .toBe(`${join(workspace.cwd, ".git", "objects")}\n`);
    await writeFile(join(linked, "tracked"), "linked");
    expect(await createSnapshot(workspace.api, linkedRepo!)).not.toBe(await createSnapshot(workspace.api, workspace.repo));
    const independent = join(workspace.root, "independent");
    workspace.git(workspace.cwd, ["init", "--quiet", independent]);
    const independentRepo = await openCheckpointRepo(workspace.api, independent);
    expect(new Set([workspace.repo.directory, linkedRepo!.directory, independentRepo!.directory]).size).toBe(3);
  });

  it("seeds staged files from the source index without changing it", async () => {
    const workspace = await checkpointWorkspace();
    await writeFile(join(workspace.cwd, ".gitignore"), "tracked\n");
    await writeFile(join(workspace.cwd, "tracked"), "staged");
    workspace.git(workspace.cwd, ["add", "--force", "tracked"]);
    const before = await readFile(join(workspace.cwd, ".git", "index"));
    const repo = await openCheckpointRepo(workspace.api, workspace.cwd);
    expect(repo).toBeDefined();
    expect(workspace.git(workspace.directory, ["ls-files"])).toBe("tracked");
    expect(await readFile(join(workspace.cwd, ".git", "index"))).toEqual(before);
  });

  it.each(["missing", "corrupt"])("falls back to HEAD when source index is %s", async (state) => {
    const workspace = await checkpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), "committed");
    workspace.git(workspace.cwd, ["add", "."]);
    workspace.git(workspace.cwd, commitArgs);
    if (state === "missing") await rm(join(workspace.cwd, ".git", "index"));
    else await writeFile(join(workspace.cwd, ".git", "index"), "broken index");
    expect(await openCheckpointRepo(workspace.api, workspace.cwd)).toBeDefined();
    expect(workspace.git(workspace.directory, ["ls-files"])).toBe("tracked");
  });

  it("captures files in an unborn repository without creating a source index", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "new"), "unborn");
    const tree = await createSnapshot(workspace.api, workspace.repo);
    expect(workspace.checkpointGit(["show", `${tree}:new`])).toBe("unborn");
    await expect(readFile(join(workspace.cwd, ".git", "index"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("mirrors changed local excludes and removes them only when the source is absent", async () => {
    const workspace = await openCheckpointWorkspace();
    const source = join(workspace.cwd, ".git", "info", "exclude");
    const mirror = join(workspace.directory, ".git", "info", "exclude");
    for (const contents of ["private\n", "other\n"]) {
      await writeFile(source, contents);
      await openCheckpointRepo(workspace.api, workspace.cwd);
      expect(await readFile(mirror, "utf8")).toBe(contents);
    }
    await rm(source);
    await openCheckpointRepo(workspace.api, workspace.cwd);
    await expect(readFile(mirror)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["root", "common", "init", "config", "seed"])("does not expose a usable repo after %s failure", async (failure) => {
    const workspace = await checkpointWorkspace();
    if (failure === "seed") {
      await writeFile(join(workspace.cwd, "tracked"), "committed");
      workspace.git(workspace.cwd, ["add", "."]);
      workspace.git(workspace.cwd, commitArgs);
      await rm(join(workspace.cwd, ".git", "index"));
    }
    const exec: ExtensionAPI["exec"] = async (command, args, options) => {
      const rejected = failure === "root" ? args.includes("--show-toplevel")
        : failure === "common" ? args.includes("--git-common-dir")
        : failure === "init" ? args[0] === "init"
        : failure === "seed" ? args.includes("read-tree")
        : args.includes("core.autocrlf");
      return rejected ? { code: 1, stdout: "", stderr: "injected Git failure", killed: false } : workspace.exec(command, args, options);
    };
    expect(await openCheckpointRepo(recordExtension({ exec }).api, workspace.cwd)).toBeUndefined();
  });

  it("rejects empty discovery output even when Git reports success", async () => {
    const api = recordExtension({ exec: async () => ({ code: 0, stdout: " \n", stderr: "", killed: false }) }).api;
    expect(await getCheckpointRepo(api, "/unused")).toBeUndefined();
  });
});
