import { getToolResultMessage } from "../entries.js";
import { getRemovedToolCallId } from "./cleanup.js";
import type { ContextPruneResult } from "./types.js";

export function buildPrunerState(entries: Record<string, unknown>[]): Set<string> {
  const removedToolCallIds = new Set<string>();
  for (const entry of entries) {
    const message = getToolResultMessage(entry);
    const toolCallId = message ? getRemovedToolCallId(message) : undefined;
    if (toolCallId) removedToolCallIds.add(toolCallId);
  }
  return removedToolCallIds;
}

export function filterContextMessages(
  messages: ContextPruneResult["messages"],
  state: Set<string>,
): ContextPruneResult {
  if (state.size === 0) return { changed: false, messages };

  const retainedMessages: ContextPruneResult["messages"] = [];
  let changed = false;
  for (const message of messages) {
    if (message.role === "toolResult" && state.has(message.toolCallId)) {
      changed = true;
      continue;
    }
    if (message.role !== "assistant") {
      retainedMessages.push(message);
      continue;
    }

    const retainedContent = message.content.filter(
      (block) => block.type !== "toolCall" || !state.has(block.id),
    );
    if (retainedContent.length === message.content.length) {
      retainedMessages.push(message);
      continue;
    }
    changed = true;
    if (retainedContent.some((block) => block.type !== "thinking")) {
      retainedMessages.push({ ...message, content: retainedContent });
    }
  }
  return { changed, messages: retainedMessages };
}
