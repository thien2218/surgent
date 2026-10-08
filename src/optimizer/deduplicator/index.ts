import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { filterToolCalls } from "../entries.js";
import { buildDeduplicatorState } from "./state.js";

export default function (pi: ExtensionAPI) {
  const hiddenCalls = new Set<string>();

  pi.on("session_start", (_event, ctx) => {
    hiddenCalls.clear();
    const branch = ctx.sessionManager.getBranch();
    const candidates = buildDeduplicatorState(ctx.sessionManager.buildSessionProjection().entries, ctx.cwd);
    for (const entry of branch) {
      if (entry.type === "message" && entry.message.role === "toolResult" && candidates.has(entry.id)) {
        hiddenCalls.add(entry.message.toolCallId);
      }
    }
  });

  pi.on("context", (event) => {
    if (hiddenCalls.size === 0) return;
    return {
      messages: event.messages.flatMap((message): typeof event.messages => {
        if (message.role === "toolResult" && hiddenCalls.has(message.toolCallId)) return [];
        if (message.role !== "assistant") return [message];
        const filtered = filterToolCalls(message, hiddenCalls);
        return filtered ? [filtered] : [];
      }),
    };
  });

  pi.on("session_tree", () => { hiddenCalls.clear(); });
  pi.on("session_shutdown", () => { hiddenCalls.clear(); });
}
