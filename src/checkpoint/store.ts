import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isUuidv7, readJson } from "../utils.js";

export const BASE_CHECKPOINT_KEY = "__base__";

export async function readCheckpointStore(
  filePath: string,
): Promise<Record<string, Record<string, string>>> {
  const data = await readJson<unknown>(filePath, {});
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const store: Record<string, Record<string, string>> = {};
  for (const [sessionId, checkpoints] of Object.entries(data)) {
    if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) continue;

    const sessionCheckpoints: Record<string, string> = {};
    for (const [entryId, tree] of Object.entries(checkpoints)) {
      if (typeof tree !== "string") continue;
      const checkpointTree = tree.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(checkpointTree)) continue;
      sessionCheckpoints[entryId] = checkpointTree;
    }
    store[sessionId] = sessionCheckpoints;
  }

  return store;
}

export async function writeCheckpointStore(
  filePath: string,
  sessionId: string,
  checkpoints: Map<string, string>,
) {
  const store = await readCheckpointStore(filePath);
  if (checkpoints.size === 0) {
    delete store[sessionId];
  } else {
    store[sessionId] = Object.fromEntries(checkpoints);
  }

  await persistCheckpointStore(filePath, store);
}

export async function pruneCheckpointStore(
  filePath: string,
  sessionIds: Set<string>,
): Promise<string[]> {
  const store = await readCheckpointStore(filePath);
  const removedTrees = new Set<string>();
  let hasChanges = false;

  for (const [sessionId, checkpoints] of Object.entries(store)) {
    if (!isUuidv7(sessionId) || sessionIds.has(sessionId)) continue;
    for (const tree of Object.values(checkpoints)) {
      removedTrees.add(tree);
    }
    delete store[sessionId];
    hasChanges = true;
  }

  if (!hasChanges) return [];
  await persistCheckpointStore(filePath, store);

  const activeTrees = new Set(
    Object.values(store).flatMap((checkpoints) => Object.values(checkpoints)),
  );
  return [...removedTrees].filter((tree) => !activeTrees.has(tree));
}

async function persistCheckpointStore(
  filePath: string,
  store: Record<string, Record<string, string>>,
) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function findCheckpoint(
  entryId: string | null,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
): string | undefined {
  let currentEntryId = entryId;
  while (currentEntryId) {
    const tree = checkpoints.get(currentEntryId);
    if (tree) return tree;
    currentEntryId = ctx.sessionManager.getEntry(currentEntryId)?.parentId ?? null;
  }

  return checkpoints.get(BASE_CHECKPOINT_KEY);
}

export function shouldOfferRestore(
  targetEntryId: string,
  currentEntryId: string | null,
  ctx: ExtensionContext,
  checkpoints: Map<string, string>,
): { shouldRestore: boolean; tree?: string } {
  const targetTree = findCheckpoint(targetEntryId, ctx, checkpoints);
  if (!targetTree) return { shouldRestore: false };

  const currentTree = findCheckpoint(currentEntryId, ctx, checkpoints);
  if (currentTree === targetTree) return { shouldRestore: false };

  return { shouldRestore: true, tree: targetTree };
}
