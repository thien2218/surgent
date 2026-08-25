import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPiPath } from "../utils.js";
import type { Repo } from "./index.js";

const CHECKPOINT_SOURCE_KEY = "surgent.checkpointSource";

export async function getCheckpointRepo(pi: ExtensionAPI, cwd: string): Promise<Repo | undefined> {
  const projectRootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  const projectRoot = projectRootResult.stdout.trim();
  if (projectRootResult.code !== 0 || !projectRoot) return undefined;

  return {
    projectRoot,
    directory: getPiPath(
      "checkpoints",
      "global",
      createHash("sha256").update(projectRoot).digest("hex"),
    ),
  };
}

export async function openCheckpointRepo(pi: ExtensionAPI, cwd: string): Promise<Repo | undefined> {
  const repo = await getCheckpointRepo(pi, cwd);
  if (!repo) return undefined;

  const sourceGitDirResult = await pi.exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repo.projectRoot },
  );
  const sourceGitDir = sourceGitDirResult.stdout.trim();
  if (sourceGitDirResult.code !== 0 || !sourceGitDir) return undefined;
  let needsInitialization = false;

  try {
    await access(join(repo.directory, ".git"));
  } catch {
    needsInitialization = true;
  }

  if (!needsInitialization) {
    const configuredSourceResult = await runCheckpointGit(pi, repo, [
      "config",
      "--get",
      CHECKPOINT_SOURCE_KEY,
    ]);
    if (
      configuredSourceResult.code !== 0 ||
      configuredSourceResult.stdout.trim() !== sourceGitDir
    ) {
      await rm(repo.directory, { recursive: true, force: true });
      needsInitialization = true;
    }
  }

  if (needsInitialization) {
    const initialized = await initializeCheckpointRepo(pi, repo, sourceGitDir);
    if (!initialized) return undefined;
  }

  await syncCheckpointIgnore(pi, repo);
  return repo;
}

export async function runCheckpointGit(pi: ExtensionAPI, repo: Repo, args: string[]) {
  return pi.exec(
    "git",
    [`--git-dir=${join(repo.directory, ".git")}`, `--work-tree=${repo.projectRoot}`, ...args],
    { cwd: repo.projectRoot },
  );
}

export async function gcCheckpointRepo(pi: ExtensionAPI, repo: Repo) {
  return runCheckpointGit(pi, repo, ["gc", "--auto"]);
}

async function initializeCheckpointRepo(
  pi: ExtensionAPI,
  repo: Repo,
  sourceGitDir: string,
): Promise<boolean> {
  try {
    await access(join(sourceGitDir, "objects"));
    await mkdir(dirname(repo.directory), { recursive: true });
  } catch {
    return false;
  }

  const initializeResult = await pi.exec("git", ["init", repo.directory], {
    cwd: repo.projectRoot,
  });
  if (initializeResult.code !== 0) return false;

  for (const config of [
    { key: "core.autocrlf", value: "false" },
    { key: "core.longpaths", value: "true" },
    { key: "core.symlinks", value: "true" },
    { key: "core.fsmonitor", value: "false" },
    { key: CHECKPOINT_SOURCE_KEY, value: sourceGitDir },
  ]) {
    const configResult = await runCheckpointGit(pi, repo, ["config", config.key, config.value]);
    if (configResult.code !== 0) return false;
  }

  const checkpointGitDir = join(repo.directory, ".git");
  try {
    await mkdir(join(checkpointGitDir, "objects", "info"), { recursive: true });
    await writeFile(
      join(checkpointGitDir, "objects", "info", "alternates"),
      `${join(sourceGitDir, "objects")}\n`,
      "utf8",
    );
  } catch {
    return false;
  }

  const sourceIndexResult = await pi.exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "index"],
    { cwd: repo.projectRoot },
  );
  let hasSeededIndex = false;
  if (sourceIndexResult.code === 0 && sourceIndexResult.stdout.trim()) {
    try {
      await copyFile(sourceIndexResult.stdout.trim(), join(checkpointGitDir, "index"));
      const indexResult = await runCheckpointGit(pi, repo, ["ls-files", "-z"]);
      hasSeededIndex = indexResult.code === 0;
      if (!hasSeededIndex) {
        await rm(join(checkpointGitDir, "index"), { force: true });
      }
    } catch {
      await rm(join(checkpointGitDir, "index"), { force: true });
    }
  }

  if (!hasSeededIndex) {
    const sourceHeadResult = await pi.exec("git", ["rev-parse", "HEAD"], {
      cwd: repo.projectRoot,
    });
    if (sourceHeadResult.code === 0 && sourceHeadResult.stdout.trim()) {
      const seedResult = await runCheckpointGit(pi, repo, [
        "read-tree",
        sourceHeadResult.stdout.trim(),
      ]);
      if (seedResult.code !== 0) return false;
    }
  }

  return true;
}

async function syncCheckpointIgnore(pi: ExtensionAPI, repo: Repo) {
  const sourceIgnoreResult = await pi.exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
    { cwd: repo.projectRoot },
  );
  if (sourceIgnoreResult.code !== 0 || !sourceIgnoreResult.stdout.trim()) return;

  const checkpointIgnoreFile = join(repo.directory, ".git", "info", "exclude");
  const sourceIgnoreFile = sourceIgnoreResult.stdout.trim();
  const sourceIgnoreContents = await readFile(sourceIgnoreFile, "utf8").catch(() => undefined);
  if (sourceIgnoreContents === undefined) {
    await rm(checkpointIgnoreFile, { force: true });
    return;
  }

  await mkdir(dirname(checkpointIgnoreFile), { recursive: true });
  await writeFile(checkpointIgnoreFile, sourceIgnoreContents, "utf8");
}
