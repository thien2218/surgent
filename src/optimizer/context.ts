import type { ContextEditEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractGrepSummary } from "./compactor/grep.js";
import { buildDeduplicatorState } from "./deduplicator/state.js";
import { getEligibleResult } from "./entries.js";
import { getRemovedToolCallId } from "./pruner/cleanup.js";

export default function (pi: ExtensionAPI) {
  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "completed") return;

    const entries = event.context.contextEntries;
    const replacements = buildDeduplicatorState(entries, ctx.cwd);
    const edits = new Map<string, ContextEditEntryDraft>();
    const removedCalls = new Set<string>();

    for (const entry of entries) {
      const message = getEligibleResult(entry);
      if (!message) continue;

      const targetId = entry.sourceEntry.id;
      if (replacements.has(targetId) || getRemovedToolCallId(message)) {
        edits.set(targetId, { type: "context_edit", targetId, replacement: null });
        removedCalls.add(message.toolCallId);
        continue;
      }
      if (message.toolName !== "grep" || message.isError || message.content.length !== 1) continue;

      const content = message.content[0];
      if (content?.type !== "text") continue;

      const summary = extractGrepSummary(content.text);
      if (!summary || summary === content.text) continue;

      edits.set(targetId, {
        type: "context_edit",
        targetId,
        replacement: { content: [{ type: "text", text: summary }] },
      });
    }

    for (const { sourceEntry, messages } of entries) {
      if (sourceEntry.type !== "message") continue;

      const message = messages[0];
      if (messages.length !== 1 || message?.role !== "assistant") continue;

      const content = message.content.filter(
        (block) => block.type !== "toolCall" || !removedCalls.has(block.id),
      );
      if (content.length === message.content.length) continue;

      const meaningful = content.some(
        (block) => block.type !== "thinking" && (block.type !== "text" || block.text.trim() !== ""),
      );
      edits.set(sourceEntry.id, {
        type: "context_edit",
        targetId: sourceEntry.id,
        replacement: meaningful ? { content } : null,
      });
    }

    if (edits.size === 0) return;
    return { entries: [...event.entries, ...edits.values()], continue: event.continue };
  });
}
