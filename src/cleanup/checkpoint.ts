import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCheckpointRepo, runCheckpointGit } from "../checkpoint/git.js";
import { pruneCheckpointStore } from "../checkpoint/store.js";

export async function cleanupCheckpoints(
  pi: ExtensionAPI,
  cwd: string,
  sessionIds: Set<string>,
) {
  const repo = await getCheckpointRepo(pi, cwd);
  if (!repo) return;

  const trees = await pruneCheckpointStore(join(repo.directory, "entries.json"), sessionIds);
  if (trees.length === 0) return;

  try {
    await access(join(repo.directory, ".git"));
  } catch {
    return;
  }

  for (const tree of trees) {
    await runCheckpointGit(pi, repo, [
      "update-ref",
      "-d",
      `refs/surgent/checkpoints/${tree}`,
    ]);
  }
}
