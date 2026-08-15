import { getEntryId, getMessage, getParentId, getToolResultMessage } from "../entries.js";
import type { RemovedEntryRemoval } from "./types.js";
import { isRecord } from "../../utils.js";

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

function hasEmptyResult(message: {
  content?: unknown;
  toolName?: unknown;
}): boolean {
  if (
    message.toolName !== "ls" &&
    message.toolName !== "find" &&
    message.toolName !== "code_diff"
  ) {
    return false;
  }

  if (!Array.isArray(message.content) || message.content.length !== 1) return false;
  const content = message.content[0];
  if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") return false;

  return (
    content.text === "(empty directory)" ||
    content.text === "No files found matching pattern" ||
    content.text === "No changes found." ||
    content.text === "No changes in selected files."
  );
}

export function getRemovedToolCallId(message: {
  content?: unknown;
  isError?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
}): string | undefined {
  if (typeof message.toolCallId !== "string") return;
  if (message.isError === true) return message.toolName === "bash" ? undefined : message.toolCallId;
  return hasEmptyResult(message) ? message.toolCallId : undefined;
}

export function removeEntries(entries: Record<string, unknown>[]): RemovedEntryRemoval {
  const removedToolCallIds = new Set<string>();
  const replacementParents = new Map<string, string | null>();

  for (const entry of entries) {
    const message = getToolResultMessage(entry);
    const entryId = getEntryId(entry);
    const toolCallId = message ? getRemovedToolCallId(message) : undefined;
    if (!entryId || !toolCallId) continue;

    removedToolCallIds.add(toolCallId);
    replacementParents.set(entryId, getParentId(entry));
  }

  if (removedToolCallIds.size === 0) {
    return { changed: false, entries, replacementParents };
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
        !removedToolCallIds.has(block.id),
    );
    if (retainedContent.length === message.content.length) {
      retainedEntries.push(entry);
      continue;
    }
    if (entryId && retainedContent.every((block) => isRecord(block) && block.type === "thinking")) {
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

  return { changed: true, entries: repairedEntries, replacementParents };
}
