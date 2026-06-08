import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPiPath, readJson, writeJson } from "../utils.js";

type SessionCheckpointStore = Record<string, Record<string, string>>;

const BASE_CHECKPOINT_KEY = "__base__";
const HEAD_REF_PREFIX = "head:";

async function readCheckpointStore(filePath: string): Promise<SessionCheckpointStore> {
  const data = await readJson<unknown>(filePath, {});
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const normalized: SessionCheckpointStore = {};

  for (const [sessionId, checkpoints] of Object.entries(data as Record<string, unknown>)) {
    if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
      continue;
    }

    const normalizedCheckpoints: Record<string, string> = {};
    for (const [entryId, stashRef] of Object.entries(checkpoints as Record<string, unknown>)) {
      if (typeof stashRef !== "string") {
        continue;
      }

      const normalizedRef = stashRef.trim();
      if (!normalizedRef) {
        continue;
      }

      normalizedCheckpoints[entryId] = normalizedRef;
    }

    normalized[sessionId] = normalizedCheckpoints;
  }

  return normalized;
}

async function createCheckpoint(
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

  const checkpointLabel = `pi-checkpoint:${sessionId}:${leafEntryId}`;
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

async function createHeadCheckpointRef(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
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

async function ensureBaseCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
): Promise<void> {
  if (checkpoints.has(BASE_CHECKPOINT_KEY)) {
    return;
  }

  const sessionId = ctx.sessionManager.getSessionId();
  const stashCheckpointRef = await createCheckpoint(pi, ctx.cwd, sessionId, BASE_CHECKPOINT_KEY);
  if (stashCheckpointRef) {
    checkpoints.set(BASE_CHECKPOINT_KEY, stashCheckpointRef);
    return;
  }

  const headCheckpointRef = await createHeadCheckpointRef(pi, ctx.cwd);
  if (headCheckpointRef) {
    checkpoints.set(BASE_CHECKPOINT_KEY, headCheckpointRef);
  }
}

function findCheckpoint(
  targetEntryId: string,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
): string {
  let currentEntryId: string | null = targetEntryId;

  while (currentEntryId) {
    const checkpointRef = checkpoints.get(currentEntryId);
    if (checkpointRef) {
      return checkpointRef;
    }

    const currentEntry = ctx.sessionManager.getEntry(currentEntryId);
    currentEntryId = currentEntry?.parentId ?? null;
  }

  return checkpoints.get(BASE_CHECKPOINT_KEY)!;
}

async function applyCheckpoint(
  pi: ExtensionAPI,
  cwd: string,
  checkpointRef: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (checkpointRef.startsWith(HEAD_REF_PREFIX)) {
    const commitHash = checkpointRef.slice(HEAD_REF_PREFIX.length).trim();
    return pi.exec("git", ["restore", `--source=${commitHash}`, "--staged", "--worktree", "."], {
      cwd,
    });
  }

  return pi.exec("git", ["stash", "apply", checkpointRef], { cwd });
}

async function restoreCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
  targetEntryId: string,
): Promise<{ cancel: boolean } | void> {
  if (!ctx.hasUI) {
    return;
  }

  const checkpointRef = findCheckpoint(targetEntryId, ctx, checkpoints);
  const options = ["Yes, restore code to that point", "No, keep current code"];
  const choice = await ctx.ui.select("Restore code state?", options);

  if (choice !== options[0]) {
    return;
  }

  const restoreResult = await applyCheckpoint(pi, ctx.cwd, checkpointRef);
  if (restoreResult.code !== 0) {
    const reason = restoreResult.stderr.trim() || restoreResult.stdout.trim();
    const message = reason
      ? `Checkpoint restore failed: ${reason}`
      : "Checkpoint restore failed due to git error.";
    ctx.ui.notify(message, "error");
    return { cancel: true };
  }

  ctx.ui.notify("Code restored to checkpoint", "info");
}

export default function (pi: ExtensionAPI): void {
  const checkpoints = new Map<string, string>();

  pi.on("session_start", async (_event, ctx) => {
    const filePath = getPiPath("checkpoints", ctx.cwd);
    const store = await readCheckpointStore(filePath);
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionCheckpoints = store[sessionId] ?? {};

    checkpoints.clear();
    for (const [entryId, stashRef] of Object.entries(sessionCheckpoints)) {
      checkpoints.set(entryId, stashRef);
    }

    await ensureBaseCheckpoint(pi, ctx, checkpoints);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!["write", "edit", "bash"].includes(event.toolName)) {
      return;
    }

    const leafEntryId = ctx.sessionManager.getLeafId();
    if (!leafEntryId) {
      return;
    }

    const sessionId = ctx.sessionManager.getSessionId();
    const checkpointRef = await createCheckpoint(pi, ctx.cwd, sessionId, leafEntryId);
    if (!checkpointRef) {
      return;
    }

    checkpoints.set(leafEntryId, checkpointRef);
  });

  pi.on("session_before_tree", (event, ctx) => {
    return restoreCheckpoint(pi, ctx, checkpoints, event.preparation.targetId);
  });

  pi.on("session_before_fork", (event, ctx) => {
    return restoreCheckpoint(pi, ctx, checkpoints, event.entryId);
  });

  pi.on("agent_end", async (_event, ctx) => {
    const filePath = getPiPath("checkpoints", ctx.cwd);
    const store = await readCheckpointStore(filePath);
    const sessionId = ctx.sessionManager.getSessionId();

    if (checkpoints.size === 0) {
      delete store[sessionId];
    } else {
      store[sessionId] = Object.fromEntries(checkpoints);
    }

    await writeJson(filePath, store);
  });
}
