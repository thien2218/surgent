import { randomBytes } from "node:crypto";
import { getEntryId, getMessage, getParentId, getToolResultMessage, isRecord } from "./entries.js";
import type { FailedEntryRemoval } from "./types.js";

function resolveRemovedId(
  entryId: string | null,
  replacementParents: Map<string, string | null>,
): string | null {
  const visitedIds = new Set<string>();
  let resolvedId = entryId;
  while (resolvedId && replacementParents.has(resolvedId) && !visitedIds.has(resolvedId)) {
    visitedIds.add(resolvedId);
    resolvedId = replacementParents.get(resolvedId) ?? null;
  }
  return resolvedId;
}

export function removeFailedEntries(entries: Record<string, unknown>[]): FailedEntryRemoval {
  const failedToolCallIds = new Set<string>();
  const replacementParents = new Map<string, string | null>();

  for (const entry of entries) {
    const message = getToolResultMessage(entry);
    const entryId = getEntryId(entry);
    if (!message || !entryId || message.isError !== true || message.toolName === "bash") continue;

    failedToolCallIds.add(message.toolCallId as string);
    replacementParents.set(entryId, getParentId(entry));
  }

  if (failedToolCallIds.size === 0) {
    return { changed: false, entries, failedToolCallIds, replacementParents };
  }

  const retainedEntries: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const entryId = getEntryId(entry);
    if (entryId && replacementParents.has(entryId)) continue;

    const message = getMessage(entry);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      retainedEntries.push(entry);
      continue;
    }

    const retainedContent = message.content.filter(
      (block) =>
        !isRecord(block) ||
        block.type !== "toolCall" ||
        typeof block.id !== "string" ||
        !failedToolCallIds.has(block.id),
    );
    if (retainedContent.length === message.content.length) {
      retainedEntries.push(entry);
      continue;
    }
    if (retainedContent.length === 0 && entryId) {
      replacementParents.set(entryId, getParentId(entry));
      continue;
    }
    retainedEntries.push({ ...entry, message: { ...message, content: retainedContent } });
  }

  const repairedEntries: Record<string, unknown>[] = [];
  for (const entry of retainedEntries) {
    const updatedEntry = { ...entry };
    let changed = false;

    const parentId = getParentId(entry);
    const repairedParentId = resolveRemovedId(parentId, replacementParents);
    if (parentId !== repairedParentId) {
      updatedEntry.parentId = repairedParentId;
      changed = true;
    }

    for (const referenceField of ["fromId", "targetId", "firstKeptEntryId"]) {
      const referenceId = entry[referenceField];
      if (typeof referenceId !== "string") continue;
      const repairedReferenceId = resolveRemovedId(referenceId, replacementParents);
      if (repairedReferenceId && repairedReferenceId !== referenceId) {
        updatedEntry[referenceField] = repairedReferenceId;
        changed = true;
      }
    }
    repairedEntries.push(changed ? updatedEntry : entry);
  }

  return {
    changed: true,
    entries: repairedEntries,
    failedToolCallIds,
    replacementParents,
  };
}

export function appendFailedToolCallState(
  entries: Record<string, unknown>[],
  failedToolCallIds: string[],
  parentId: string | null,
): boolean {
  if (failedToolCallIds.length === 0) return false;

  const entryIds = new Set<string>();
  for (const entry of entries) {
    const entryId = getEntryId(entry);
    if (entryId) entryIds.add(entryId);
  }

  let entryId = randomBytes(4).toString("hex");
  while (entryIds.has(entryId)) entryId = randomBytes(4).toString("hex");

  entries.push({
    type: "custom",
    customType: "pruner",
    data: { failedToolCallIds },
    id: entryId,
    parentId,
    timestamp: new Date().toISOString(),
  });
  return true;
}
