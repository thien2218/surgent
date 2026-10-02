import { openCheckpointRepo } from "../../src/checkpoint/git.js";
import { checkpointWorkspace } from "./cleanup.js";

export async function openCheckpointWorkspace() {
  const workspace = await checkpointWorkspace();
  const repo = await openCheckpointRepo(workspace.api, workspace.cwd);
  if (!repo) throw new Error("Failed to open disposable checkpoint repository");
  const checkpointGit = (args: string[]) => workspace.git(workspace.cwd, [
    `--git-dir=${repo.directory}/.git`, `--work-tree=${repo.projectRoot}`, ...args,
  ]);
  return { ...workspace, repo, checkpointGit };
}
