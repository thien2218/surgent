import {
  getBranchEntries,
  getEntryId,
  getLastEntryId,
  getRepeatIds,
  getToolResultMessage,
  isRecord,
} from "./entries.js";
import type { ContextPruneResult, PrunerState } from "./types.js";

function collectPersistedFailedToolCallIds(entries: Record<string, unknown>[]): Set<string> {
  const failedToolCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== "pruner") continue;

    const data = entry.data;
    if (!isRecord(data)) continue;

    const persistedIds = data.failedToolCallIds;
    if (!Array.isArray(persistedIds)) continue;

    for (const persistedId of persistedIds) {
      if (typeof persistedId === "string" && persistedId.length > 0) {
        failedToolCallIds.add(persistedId);
      }
    }
  }
  return failedToolCallIds;
}

export function buildPrunerState(
  entries: Record<string, unknown>[],
  leafId: string | null,
): PrunerState {
  let activeEntries = getBranchEntries(entries, leafId);
  if (activeEntries.length === 0 && leafId !== null) {
    activeEntries = getBranchEntries(entries, getLastEntryId(entries));
  }
  const resultEntryIds = new Set<string>();
  const replacementIdsByToolCallId = new Map<string, string[]>();
  for (const entry of activeEntries) {
    const entryId = getEntryId(entry);
    const message = getToolResultMessage(entry);
    if (!entryId || !message || (message.toolName !== "read" && message.toolName !== "inspect")) {
      continue;
    }

    resultEntryIds.add(entryId);
    const repeatIds = getRepeatIds(message);
    if (repeatIds) replacementIdsByToolCallId.set(message.toolCallId as string, repeatIds);
  }

  return {
    failedToolCallIds: collectPersistedFailedToolCallIds(entries),
    replacementIdsByToolCallId,
    resultEntryIds,
  };
}

export function emptyPrunerState(): PrunerState {
  return {
    failedToolCallIds: new Set<string>(),
    replacementIdsByToolCallId: new Map<string, string[]>(),
    resultEntryIds: new Set<string>(),
  };
}

export function filterContextMessages(
  messages: ContextPruneResult["messages"],
  state: PrunerState,
): ContextPruneResult {
  const prunedToolCallIds = new Set(state.failedToolCallIds);
  for (const [toolCallId, repeatIds] of state.replacementIdsByToolCallId) {
    if (repeatIds.every((repeatId) => state.resultEntryIds.has(repeatId))) {
      prunedToolCallIds.add(toolCallId);
    }
  }
  if (prunedToolCallIds.size === 0) return { changed: false, messages };

  const retainedMessages: ContextPruneResult["messages"] = [];
  let changed = false;
  for (const message of messages) {
    if (message.role === "toolResult" && prunedToolCallIds.has(message.toolCallId)) {
      changed = true;
      continue;
    }
    if (message.role !== "assistant") {
      retainedMessages.push(message);
      continue;
    }

    const retainedContent = message.content.filter(
      (block) => block.type !== "toolCall" || !prunedToolCallIds.has(block.id),
    );
    if (retainedContent.length === message.content.length) {
      retainedMessages.push(message);
      continue;
    }
    changed = true;
    if (retainedContent.length > 0) {
      retainedMessages.push({ ...message, content: retainedContent });
    }
  }
  return { changed, messages: retainedMessages };
}
