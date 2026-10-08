import type { ContextEditEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { filterToolCalls, getEligibleResult } from "../entries.js";
import { getRemovedToolCallId } from "./cleanup.js";

export default function (pi: ExtensionAPI) {
  pi.on("agent_before_settle", (event) => {
    if (event.outcome !== "completed") return;

    const entries = event.context.contextEntries;
    const edits = new Map<string, ContextEditEntryDraft>();
    const removedCalls = new Set<string>();

    for (const entry of entries) {
      const message = getEligibleResult(entry);
      if (!message) continue;

      const targetId = entry.sourceEntry.id;
      if (getRemovedToolCallId(message)) {
        edits.set(targetId, { type: "context_edit", targetId, replacement: null });
        removedCalls.add(message.toolCallId);
        continue;
      }
      if (message.toolName !== "grep" || message.isError) continue;

      const content = message.content.map((block) => {
        if (block.type !== "text") return block;
        const text = block.text.split("\n").filter((line) => !/^\d+- /.test(line)).join("\n");
        return text === block.text ? block : { ...block, text };
      });
      if (content.some((block, index) => block !== message.content[index])) {
        edits.set(targetId, { type: "context_edit", targetId, replacement: { content } });
      }
    }

    for (const { sourceEntry, messages } of entries) {
      if (sourceEntry.type !== "message") continue;

      const message = messages[0];
      if (messages.length !== 1 || message?.role !== "assistant") continue;

      const filtered = filterToolCalls(message, removedCalls);
      if (filtered === message) continue;

      edits.set(sourceEntry.id, {
        type: "context_edit",
        targetId: sourceEntry.id,
        replacement: filtered ? { content: filtered.content } : null,
      });
    }

    if (edits.size === 0) return;
    return { entries: [...event.entries, ...edits.values()], continue: event.continue };
  });
}
