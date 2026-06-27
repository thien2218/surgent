import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HEAD_REF_PREFIX = "head:";
export const CHECKPOINT_LABEL_PREFIX = "checkpoint:";

type GitCommandResult = { code: number; stdout: string; stderr: string };

export async function createCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  sessionId: string,
  leafEntryId: string,
): Promise<string | undefined> {
  const createResult = await pi.exec("git", ["stash", "create"], { cwd });
  if (createResult.code !== 0) {
    return undefined;
  }

  const stashRef = createResult.stdout.trim();
  if (!stashRef) {
    return undefined;
  }

  const checkpointLabel = `${CHECKPOINT_LABEL_PREFIX}${sessionId}:${leafEntryId}`;
  const stashStoreResult = await pi.exec(
    "git",
    ["stash", "store", "-m", checkpointLabel, stashRef],
    { cwd },
  );

  if (stashStoreResult.code !== 0) {
    return undefined;
  }

  return stashRef;
}

export async function createHeadCheckpointRef(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string | undefined> {
  const revParseResult = await pi.exec("git", ["rev-parse", "HEAD"], { cwd });
  if (revParseResult.code !== 0) {
    return undefined;
  }

  const commitHash = revParseResult.stdout.trim();
  if (!commitHash) {
    return undefined;
  }

  return `${HEAD_REF_PREFIX}${commitHash}`;
}

export async function applyCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  checkpointRef: string,
): Promise<GitCommandResult> {
  const sourceRef = checkpointRef.startsWith(HEAD_REF_PREFIX)
    ? checkpointRef.slice(HEAD_REF_PREFIX.length).trim()
    : checkpointRef;

  if (!sourceRef) {
    return { code: 1, stdout: "", stderr: "Invalid checkpoint reference." };
  }

  return pi.exec("git", ["restore", `--source=${sourceRef}`, "--worktree", "."], {
    cwd,
  });
}
