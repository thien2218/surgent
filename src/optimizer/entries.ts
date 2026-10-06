import { isDeepStrictEqual } from "node:util";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
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
