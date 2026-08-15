import { statSync } from "node:fs";
import { isBashToolResult, isGrepToolResult } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rewriteTailWithSummaries } from "./helpers.js";
import { extractBashSummary, extractGrepSummary } from "./extractors.js";
import type { SummaryStore } from "./types.js";

export default function (pi: ExtensionAPI) {
  const store: SummaryStore = { active: new Map(), pending: new Map() };
  const pendingWrites = new Map<string, string>();
  let writeStartOffset = 0;

  pi.on("agent_start", async (_event, ctx) => {
    store.pending.clear();
    if (pendingWrites.size > 0) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      writeStartOffset = 0;
      return;
    }

    try {
      writeStartOffset = statSync(sessionFile).size;
    } catch {
      writeStartOffset = 0;
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

  pi.on("agent_end", async (event) => {
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

      for (const [toolCallId, summaryText] of completedRunSummaries) {
        store.active.set(toolCallId, summaryText);
        pendingWrites.set(toolCallId, summaryText);
      }
    } finally {
      store.pending.clear();
    }
  });

  pi.on("session_shutdown", (event, ctx) => {
    if (pendingWrites.size === 0) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) {
      rewriteTailWithSummaries(sessionFile, writeStartOffset, pendingWrites);
    }
    if (event.targetSessionFile && event.targetSessionFile !== sessionFile) {
      rewriteTailWithSummaries(event.targetSessionFile, writeStartOffset, pendingWrites);
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
