import type { Range } from "../inspector/types.js";
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
  if (prunedToolCallIds.size === 0) {
    return { changed: false, messages };
  }

  const retainedMessages: ContextEvent["messages"] = [];
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
    if (retainedContent.some((block) => block.type !== "thinking")) {
      retainedMessages.push({ ...message, content: retainedContent });
    }
  }
  return { changed, messages: retainedMessages };
}

export function mergeRanges(ranges: Range[]) {
  const sortedRanges = ranges.toSorted(([firstStart], [secondStart]) => firstStart - secondStart);
  const mergedRanges: Range[] = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || previousRange[1] < range[0] - 1) {
      mergedRanges.push([range[0], range[1]]);
      continue;
    }
    previousRange[1] = Math.max(previousRange[1], range[1]);
  }

  return mergedRanges;
}

export function hasFullCoverage(range: Range, candidates: Range[]): boolean {
  const intersections: Range[] = [];
  for (const candidate of candidates) {
    const start = Math.max(range[0], candidate[0]);
    const end = Math.min(range[1], candidate[1]);
    if (start <= end) intersections.push([start, end]);
  }
  if (intersections.length === 0) return false;

  const merged = mergeRanges(intersections);
  return (
    merged.reduce((lines, [start, end]) => lines + end - start + 1, 0) === range[1] - range[0] + 1
  );
}
