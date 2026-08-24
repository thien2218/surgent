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
  return runCheckpointGit(pi, projectRoot, directory, ["read-tree", "--reset", "-u", tree]);
}
