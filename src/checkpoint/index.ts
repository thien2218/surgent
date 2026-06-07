import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPiPath, readJson, writeJson } from "../utils.js";

type SessionCheckpointStore = Record<string, Record<string, string>>;

function isCheckpointToolName(toolName: string): boolean {
  return toolName === "write" || toolName === "edit" || toolName === "bash";
}

function normalizeCheckpointStore(data: unknown): SessionCheckpointStore {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const store: SessionCheckpointStore = {};

  for (const [sessionId, sessionCheckpoints] of Object.entries(data as Record<string, unknown>)) {
    if (
      !sessionCheckpoints ||
      typeof sessionCheckpoints !== "object" ||
      Array.isArray(sessionCheckpoints)
    ) {
      continue;
    }
    const normalized: Record<string, string> = {};

    for (const [entryId, stashRef] of Object.entries(
      sessionCheckpoints as Record<string, unknown>,
    )) {
      if (typeof stashRef !== "string") {
        continue;
      }

      const normalizedRef = stashRef.trim();
      if (!normalizedRef) {
        continue;
      }

      normalized[entryId] = normalizedRef;
    }

    store[sessionId] = normalized;
  }

  return store;
}

async function readCheckpointStore(checkpointFilePath: string): Promise<SessionCheckpointStore> {
  const data = await readJson<unknown>(checkpointFilePath, {});
  return normalizeCheckpointStore(data);
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

  const checkpointLabel = `pi-checkpoint:${sessionId}:${leafEntryId}:${Date.now()}`;
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

function findCheckpointForTargetEntry(
  targetEntryId: string,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
) {
  let currentEntryId: string | null = targetEntryId;

  while (currentEntryId) {
    const checkpointRef = checkpoints.get(currentEntryId);
    if (checkpointRef) {
      return checkpointRef;
    }

    const currentEntry = ctx.sessionManager.getEntry(currentEntryId);
    currentEntryId = currentEntry?.parentId ?? null;
  }

  return undefined;
}

async function maybeRestoreCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
  targetEntryId: string,
): Promise<boolean> {
  const options = ["Yes, restore code to that point", "No, keep current code"];
  const checkpointRef = findCheckpointForTargetEntry(targetEntryId, ctx, checkpoints);
  if (!checkpointRef) {
    return false;
  }

  if (!ctx.hasUI) {
    return false;
  }

  const choice = await ctx.ui.select("Restore code state?", options);
  if (choice !== options[0]) {
    return false;
  }

  const stashApplyResult = await pi.exec("git", ["stash", "apply", checkpointRef], {
    cwd: ctx.cwd,
  });
  if (stashApplyResult.code !== 0) {
    const reason = stashApplyResult.stderr.trim() || stashApplyResult.stdout.trim();
    const message = reason
      ? `Checkpoint restore failed: ${reason}`
      : "Checkpoint restore failed due to git stash apply error.";
    ctx.ui.notify(message, "error");
    return true;
  }

  ctx.ui.notify("Code restored to checkpoint", "info");
  return false;
}

export default function checkpoint(pi: ExtensionAPI): void {
  const checkpoints = new Map<string, string>();

  pi.on("session_start", async (_event, ctx) => {
    const checkpointFilePath = getPiPath("checkpoints", ctx.cwd);
    const checkpointStore = await readCheckpointStore(checkpointFilePath);
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionCheckpoints = checkpointStore[sessionId] ?? {};

    checkpoints.clear();
    for (const [entryId, stashRef] of Object.entries(sessionCheckpoints)) {
      checkpoints.set(entryId, stashRef);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!isCheckpointToolName(event.toolName)) {
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

  pi.on("session_before_tree", async (event, ctx) => {
    const shouldCancel = await maybeRestoreCheckpoint(
      pi,
      ctx,
      checkpoints,
      event.preparation.targetId,
    );

    if (shouldCancel) {
      return { cancel: true };
    }
  });

  pi.on("session_before_fork", async (event, ctx) => {
    const shouldCancel = await maybeRestoreCheckpoint(pi, ctx, checkpoints, event.entryId);
    if (shouldCancel) {
      return { cancel: true };
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    const checkpointFilePath = getPiPath("checkpoints", ctx.cwd);
    const checkpointStore = await readCheckpointStore(checkpointFilePath);
    const sessionId = ctx.sessionManager.getSessionId();

    if (checkpoints.size === 0) {
      delete checkpointStore[sessionId];
    } else {
      checkpointStore[sessionId] = Object.fromEntries(checkpoints);
    }

    await writeJson(checkpointFilePath, checkpointStore);
  });
}
