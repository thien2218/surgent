import type {
  ContextEditEntryDraft,
  ExtensionAPI,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { filterToolCalls, getEligibleResult } from "../entries.js";
import { getRetriedCalls, shouldRemoveToolCall } from "./cleanup.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // Session start has no boundary for drafts; the getter returns the live manager.
    const manager = ctx.sessionManager as SessionManager;
    const entries = manager.buildSessionProjection().entries;
    const lastReply = entries.findLastIndex(
      ({ sourceEntry }) =>
        sourceEntry.type === "message" && sourceEntry.message.role === "assistant",
    );
    if (lastReply === -1) return;

    const edits = new Map<string, ContextEditEntryDraft>();
    const removedCalls = new Set<string>();

    // Results after the last reply have not been seen by the model yet.
    const seen = entries.slice(0, lastReply);
    const retriedCalls = getRetriedCalls(seen);
    for (const entry of seen) {
      const message = getEligibleResult(entry);
      const targetId = entry.sourceEntry.id;
      if (!message) continue;

      if (shouldRemoveToolCall(message, retriedCalls)) {
        edits.set(targetId, { type: "context_edit", targetId, replacement: null });
        removedCalls.add(message.toolCallId);
        continue;
      }
      if (message.toolName !== "grep" || message.isError) continue;

      const content = message.content.map((block) => {
        if (block.type !== "text") return block;
        const text = block.text
          .split("\n")
          .filter((line) => !/^\d+- /.test(line))
          .join("\n");
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

    for (const edit of edits.values()) {
      manager.appendContextEdit(edit.targetId, edit.replacement);
    }
  });
}
