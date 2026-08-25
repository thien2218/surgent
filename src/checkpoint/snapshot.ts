import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runCheckpointGit } from "./git.js";
import { stageCheckpoint } from "./stage.js";
import type { Repo } from "./index.js";

export async function createSnapshot(pi: ExtensionAPI, repo: Repo): Promise<string | undefined> {
  const staged = await stageCheckpoint(pi, repo);
  if (!staged) return undefined;

  const treeResult = await runCheckpointGit(pi, repo, ["write-tree"]);
  if (treeResult.code !== 0) return undefined;

  const tree = treeResult.stdout.trim();
  return /^[0-9a-f]{40,64}$/i.test(tree) ? tree : undefined;
}

export async function retainSnapshot(pi: ExtensionAPI, repo: Repo, tree: string): Promise<boolean> {
  const referenceResult = await runCheckpointGit(pi, repo, [
    "update-ref",
    `refs/surgent/checkpoints/${tree}`,
    tree,
  ]);
  return referenceResult.code === 0;
}

export async function restoreSnapshot(pi: ExtensionAPI, repo: Repo, tree: string) {
  return runCheckpointGit(pi, repo, ["read-tree", "--reset", "-u", tree]);
}
