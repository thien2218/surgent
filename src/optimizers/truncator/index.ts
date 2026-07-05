import { statSync } from "node:fs";
import { isBashToolResult, isGrepToolResult } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rebuildActiveSummaries, rewriteTailWithSummaries } from "./helpers.js";
import { extractBashSummary, extractGrepSummary } from "./extractors.js";
import type { PersistedState, SummaryStore } from "./types.js";

const CUSTOM_ENTRY_TYPE = "read-summarizer";

export default function (pi: ExtensionAPI) {
  const store: SummaryStore = { active: new Map(), pending: new Map() };
  let runStartOffset = 0;

  pi.on("session_start", async (_event, ctx) => {
    store.pending.clear();
    rebuildActiveSummaries(store, ctx.sessionManager.getBranch(), CUSTOM_ENTRY_TYPE);
  });

  pi.on("session_tree", async (_event, ctx) => {
    store.pending.clear();
    rebuildActiveSummaries(store, ctx.sessionManager.getBranch(), CUSTOM_ENTRY_TYPE);
  });

  pi.on("agent_start", async (_event, ctx) => {
    store.pending.clear();

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      runStartOffset = 0;
      return;
    }

    try {
      runStartOffset = statSync(sessionFile).size;
    } catch {
      runStartOffset = 0;
    }
  });

  pi.on("tool_result", async (event) => {
    if (isGrepToolResult(event)) {
      const summary = extractGrepSummary(event);
      if (summary) {
        store.pending.set(event.toolCallId, summary);
      }
    } else if (isBashToolResult(event)) {
      const summary = extractBashSummary(event);
      if (summary) {
        store.pending.set(event.toolCallId, summary);
      }
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    const completedRunSummaries = new Map<string, string>();

    try {
      for (const message of event.messages) {
        if (
          message.role === "toolResult" &&
          (message.toolName === "grep" || message.toolName === "bash") &&
          store.pending.has(message.toolCallId)
        ) {
          completedRunSummaries.set(message.toolCallId, store.pending.get(message.toolCallId)!);
        }
      }

      if (completedRunSummaries.size === 0) return;

      for (const [toolCallId, summaryText] of completedRunSummaries) {
        store.active.set(toolCallId, summaryText);
      }

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) {
        rewriteTailWithSummaries(sessionFile, runStartOffset, completedRunSummaries);
      }

      pi.appendEntry(CUSTOM_ENTRY_TYPE, {
        summaries: Object.fromEntries(completedRunSummaries),
      } satisfies PersistedState);
    } finally {
      store.pending.clear();
    }
  });

  pi.on("context", async (event) => {
    if (store.active.size === 0) return;

    let changed = false;
    for (const message of event.messages) {
      if (
        message.role !== "toolResult" ||
        (message.toolName !== "grep" && message.toolName !== "bash")
      ) {
        continue;
      }
      const summaryText = store.active.get(message.toolCallId);
      if (!summaryText) continue;

      message.content = [{ type: "text", text: summaryText }];
      changed = true;
    }

    if (!changed) return;
    return { messages: event.messages };
  });
}
