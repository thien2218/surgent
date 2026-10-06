import type { ContextEditEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { extractGrepSummary } from "./grep.js";

export default function (pi: ExtensionAPI) {
  pi.on("agent_before_settle", (event) => {
    if (event.outcome !== "completed") return;

    const edits: ContextEditEntryDraft[] = [];
    for (const entry of event.context.contextEntries) {
      const message = getEligibleResult(entry);
      if (!message || message.toolName !== "grep" || message.isError || message.content.length !== 1) continue;

      const content = message.content[0];
      if (content?.type !== "text") continue;

      const summary = extractGrepSummary(content.text);
      if (!summary || summary === content.text) continue;

      edits.push({
        type: "context_edit",
        targetId: entry.sourceEntry.id,
        replacement: { content: [{ type: "text", text: summary }] },
      });
    }

    if (edits.length === 0) return;
    return { entries: [...event.entries, ...edits], continue: event.continue };
  });
}
