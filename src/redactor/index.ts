import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { containSecrets, replaceSecrets } from "./secrets.js";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (!event.input || typeof event.input !== "object" || Array.isArray(event.input)) {
      return { block: true, reason: "Invalid input for secret scanning" };
    }

    if (isToolCallEventType("write", event)) {
      if (typeof event.input.content !== "string") {
        return { block: true, reason: "Invalid write content for secret scanning" };
      }
      if (containSecrets(event.input.content)) {
        return { block: true, reason: "Secrets detected in content to be written" };
      }
    } else {
      const { edits } = event.input as { edits?: unknown };
      if (!Array.isArray(edits)) {
        return { block: true, reason: "Invalid edits for secret scanning" };
      }
      for (const edit of edits) {
        if (!edit || typeof edit !== "object" || Array.isArray(edit) ||
          typeof edit.newText !== "string") {
          return { block: true, reason: "Invalid edit content for secret scanning" };
        }
        if (containSecrets(edit.newText)) {
          return { block: true, reason: "Secrets detected in edit content" };
        }
      }
    }
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "read" && event.toolName !== "bash" && event.toolName !== "grep") return;

    const content = event.content.map((block) => {
      if (block.type !== "text") return block;
      const redactedText = replaceSecrets(block.text);
      return { ...block, text: redactedText };
    });

    return { details: event.details, isError: event.isError, content };
  });
}
