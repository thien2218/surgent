import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { DeduplicatorState } from "./types.js";

export function filterDeduplicatedMessages(
  messages: ContextEvent["messages"],
  state: DeduplicatorState,
): { changed: boolean; messages: ContextEvent["messages"] } {
  const prunedToolCallIds = new Set<string>();
  for (const [toolCallId, repeatIds] of state.replacementsByCallId) {
    if (repeatIds.every((repeatId) => state.resultEntryIds.has(repeatId))) {
      prunedToolCallIds.add(toolCallId);
    }
  }
  if (prunedToolCallIds.size === 0 && state.replacementToolCallIds.size === 0) {
    return { changed: false, messages };
  }

  const retainedMessages: ContextEvent["messages"] = [];
  let changed = false;
  for (const message of messages) {
    if (message.role === "toolResult" && prunedToolCallIds.has(message.toolCallId)) {
      changed = true;
      continue;
    }
    if (message.role === "toolResult" && state.replacementToolCallIds.has(message.toolCallId)) {
      const originalContent = message.details?.originalContent;
      if (typeof originalContent === "string") {
        changed = true;
        retainedMessages.push({
          ...message,
          content: [{ type: "text", text: originalContent }],
        });
        continue;
      }
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
    if (retainedContent.some((block) => block.type !== "thinking")) {
      retainedMessages.push({ ...message, content: retainedContent });
    }
  }
  return { changed, messages: retainedMessages };
}
