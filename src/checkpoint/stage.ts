import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCheckpointGit } from "./git.js";

const UNTRACKED_FILE_LIMIT = 2 * 1024 * 1024;
const STAGE_BATCH_SIZE = 100;

export async function stageCheckpoint(
  pi: ExtensionAPI,
  projectRoot: string,
  directory: string,
): Promise<boolean> {
  const changedResult = await runCheckpointGit(pi, projectRoot, directory, [
    "diff-files",
    "--name-only",
    "-z",
    "--",
    ".",
  ]);
  if (changedResult.code !== 0) return false;

  const untrackedResult = await runCheckpointGit(pi, projectRoot, directory, [
    "ls-files",
    "--full-name",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);
  if (untrackedResult.code !== 0) return false;

  const filePaths = changedResult.stdout.split("\0").filter(Boolean);

  await Promise.all(
    untrackedResult.stdout.split("\0").map(async (filePath) => {
      if (!filePath) return;
      try {
        const fileStatus = await lstat(join(projectRoot, filePath));
        if (fileStatus.isFile() && fileStatus.size > UNTRACKED_FILE_LIMIT) return;
        filePaths.push(filePath);
      } catch {
        return; // file disappeared before staging.
      }
    }),
  );

  for (let start = 0; start < filePaths.length; start += STAGE_BATCH_SIZE) {
    const stageResult = await runCheckpointGit(pi, projectRoot, directory, [
      "add",
      "--all",
      "--",
      ...filePaths
        .slice(start, start + STAGE_BATCH_SIZE)
        .map((filePath) => `:(top,literal)${filePath}`),
    ]);
    if (stageResult.code !== 0) return false;
  }

  return true;
}
