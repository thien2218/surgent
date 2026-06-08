import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPiPath, readJson, writeJson } from "../utils.js";

type SessionCheckpointStore = Record<string, Record<string, string>>;

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

function findCheckpoint(
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
  if (!checkpointRef) {
    return;
  }

  const options = ["Yes, restore code to that point", "No, keep current code"];
  const choice = await ctx.ui.select("Restore code state?", options);

  if (choice !== options[0]) {
    return;
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
    return { cancel: true };
  }

  ctx.ui.notify("Code restored to checkpoint", "info");
  return;
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
