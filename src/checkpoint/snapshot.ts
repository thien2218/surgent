import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCheckpointGit } from "./git.js";
import { stageCheckpoint } from "./stage.js";

export async function createSnapshot(
  pi: ExtensionAPI,
  projectRoot: string,
  directory: string,
): Promise<string | undefined> {
  const staged = await stageCheckpoint(pi, projectRoot, directory);
  if (!staged) return undefined;

  const treeResult = await runCheckpointGit(pi, projectRoot, directory, ["write-tree"]);
  if (treeResult.code !== 0) return undefined;

  const tree = treeResult.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(tree)) return undefined;

  const referenceResult = await runCheckpointGit(pi, projectRoot, directory, [
    "update-ref",
    `refs/surgent/checkpoints/${tree}`,
    tree,
  ]);
  return referenceResult.code === 0 ? tree : undefined;
}

export async function restoreSnapshot(
  pi: ExtensionAPI,
  projectRoot: string,
  directory: string,
  tree: string,
) {
  const currentTreeResult = await runCheckpointGit(pi, projectRoot, directory, ["write-tree"]);
  if (currentTreeResult.code !== 0) return currentTreeResult;

  const removedFilesResult = await runCheckpointGit(pi, projectRoot, directory, [
    "diff",
    "--name-only",
    "--diff-filter=A",
    "-z",
    tree,
    currentTreeResult.stdout.trim(),
  ]);
  if (removedFilesResult.code !== 0) return removedFilesResult;

  const readTreeResult = await runCheckpointGit(pi, projectRoot, directory, ["read-tree", tree]);
  if (readTreeResult.code !== 0) return readTreeResult;

  const checkoutResult = await runCheckpointGit(pi, projectRoot, directory, [
    "checkout-index",
    "--all",
    "--force",
  ]);
  if (checkoutResult.code !== 0) return checkoutResult;

  for (const filePath of removedFilesResult.stdout.split("\0").filter(Boolean)) {
    const targetPath = resolve(projectRoot, filePath);
    const targetRelativePath = relative(projectRoot, targetPath);
    if (
      !targetRelativePath ||
      targetRelativePath === ".." ||
      targetRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(targetRelativePath)
    ) {
      return { code: 1, stdout: "", stderr: `Unsafe checkpoint path: ${filePath}` };
    }

    try {
      await rm(targetPath, { recursive: true, force: true });
    } catch (error) {
      return {
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return checkoutResult;
}
