import { isDeepStrictEqual } from "node:util";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";

/** Optimize only original result content, never omissions or external replacements. */
export function getEligibleResult(entry: ProjectedSessionEntry): ToolResultMessage | undefined {
  const { sourceEntry, messages } = entry;
  if (sourceEntry.type !== "message" || sourceEntry.message.role !== "toolResult") return;
  const message = messages[0];
  if (messages.length !== 1 || message?.role !== "toolResult") return;
  if (!isDeepStrictEqual(message.content, sourceEntry.message.content)) return;
  return message;
}

export function filterToolCalls(message: AssistantMessage, removedCalls: ReadonlySet<string>): AssistantMessage | undefined {
  const content = message.content.filter(
    (block) => block.type !== "toolCall" || !removedCalls.has(block.id),
  );
  if (content.length === message.content.length) return message;

  const meaningful = content.some(
    (block) => block.type !== "thinking" && (block.type !== "text" || block.text.trim() !== ""),
  );
  if (meaningful) return { ...message, content };
}
