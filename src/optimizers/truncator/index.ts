import { statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rewriteTailWithSummaries, extractBashSummary, extractGrepSummary } from "./helpers.js";

export default function (pi: ExtensionAPI) {
  const store = new Map<string, string>();
  const pendingWrites = new Map<string, string>();
  let writeStartOffset = 0;

  pi.on("agent_start", async (_event, ctx) => {
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

  pi.on("agent_end", async (event) => {
    for (const message of event.messages) {
      if (message.role !== "toolResult") continue;
      const text = message.content.find((content) => content.type === "text")?.text;
      if (text === undefined) continue;

      let summary: string | null = null;
      if (message.toolName === "grep") {
        summary = extractGrepSummary(text);
      } else if (message.toolName === "bash") {
        summary = extractBashSummary(text, message.details);
      }

      if (!summary) continue;
      store.set(message.toolCallId, summary);
      pendingWrites.set(message.toolCallId, summary);
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
    if (store.size === 0) return;

    let changed = false;
    for (const message of event.messages) {
      if (
        message.role !== "toolResult" ||
        (message.toolName !== "grep" && message.toolName !== "bash")
      ) {
        continue;
      }

      const summaryText = store.get(message.toolCallId);
      if (!summaryText) continue;

      message.content = [{ type: "text", text: summaryText }];
      changed = true;
    }

    if (!changed) return;
    return { messages: event.messages };
  });
}
