import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { PersistedState, SummaryStore } from "./types.js";

export function rebuildActiveSummaries(
  store: SummaryStore,
  branchEntries: Array<{ type: string; customType?: string; data?: unknown }>,
  customEntryType: string,
): void {
  store.active.clear();

  for (const entry of branchEntries) {
    if (entry.type !== "custom" || entry.customType !== customEntryType) {
      continue;
    }

    const state = entry.data as PersistedState;
    if (
      !state ||
      typeof state !== "object" ||
      !state.summaries ||
      typeof state.summaries !== "object"
    ) {
      continue;
    }

    for (const [toolCallId, summaryText] of Object.entries(state.summaries)) {
      if (typeof summaryText === "string" && summaryText.length > 0) {
        store.active.set(toolCallId, summaryText);
      }
    }
  }
}

export function rewriteSessionTailWithSummaries(
  sessionFile: string,
  runStartOffset: number,
  completedRunSummaries: Map<string, string>,
): void {
  if (completedRunSummaries.size === 0) {
    return;
  }

  const sessionBuffer = readFileSync(sessionFile);
  if (runStartOffset > sessionBuffer.length) {
    return;
  }

  const prefixBuffer = sessionBuffer.subarray(0, runStartOffset);
  const tailText = sessionBuffer.subarray(runStartOffset).toString("utf-8");
  if (tailText.length === 0) {
    return;
  }

  let changed = false;
  const rewrittenTail = tailText
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const message = entry.message as Record<string, unknown> | undefined;
      if (
        entry.type === "message" &&
        message?.role === "toolResult" &&
        typeof message.toolCallId === "string" &&
        completedRunSummaries.has(message.toolCallId)
      ) {
        changed = true;
        return JSON.stringify({
          ...entry,
          message: {
            ...message,
            content: [{ type: "text", text: completedRunSummaries.get(message.toolCallId)! }],
          },
        });
      }
      return line;
    })
    .join("\n");

  if (!changed) {
    return;
  }

  const tempFile = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempFile, prefixBuffer);
    appendFileSync(tempFile, `${rewrittenTail}\n`, "utf8");
    renameSync(tempFile, sessionFile);
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}
