import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { onTestFinished, vi } from "vitest";
import { getPiPath } from "../../src/utils.js";
import { recordExtension } from "./extension.js";
import { makePermissionWorkspace } from "./permission.js";

export async function cleanupWorkspace() {
  const workspace = await makePermissionWorkspace("surgent-cleanup-");
  onTestFinished(workspace.restore);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  vi.stubEnv("USERPROFILE", workspace.home);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(workspace.home, ".pi", "agent"));
  return workspace;
}

export async function checkpointWorkspace() {
  const workspace = await cleanupWorkspace();
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: workspace.home,
    USERPROFILE: workspace.home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(workspace.home, ".gitconfig"),
  };
  const git = (cwd: string, args: string[], input?: string) => {
    const result = spawnSync("git", args, { cwd, env, input, encoding: "utf8", timeout: 10_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const exec: ExtensionAPI["exec"] = async (command, args, options) => {
    const result = spawnSync(command, args, {
      cwd: options?.cwd ?? workspace.cwd, env, encoding: "utf8", timeout: 10_000,
    });
    if (result.error) throw result.error;
    return { stdout: result.stdout, stderr: result.stderr, code: result.status ?? 1, killed: false };
  };
  git(workspace.cwd, ["init", "--quiet"]);
  const projectRoot = git(workspace.cwd, ["rev-parse", "--show-toplevel"]);
  const directory = getPiPath("checkpoints", "global", createHash("sha256").update(projectRoot).digest("hex"));
  git(workspace.cwd, ["init", "--quiet", directory]);
  const tree = (content: string) => {
    const blob = git(directory, ["hash-object", "-w", "--stdin"], content);
    const hash = git(directory, ["mktree"], `100644 blob ${blob}\tfile\n`);
    git(directory, ["update-ref", `refs/surgent/checkpoints/${hash}`, hash]);
    return hash;
  };
  const refs = () => git(directory, ["for-each-ref", "--format=%(objectname)", "refs/surgent/checkpoints"])
    .split("\n").filter(Boolean).sort();
  return { ...workspace, directory, storePath: join(directory, "entries.json"), git, exec, tree, refs, api: recordExtension({ exec }).api };
}
