import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { containSecrets, replaceSecrets } from "./secrets.js";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (isToolCallEventType("write", event)) {
      if (containSecrets(event.input.content ?? "")) {
        return { block: true, reason: "Secrets detected in content to be written" };
      }
    } else if (isToolCallEventType("edit", event)) {
      const edits: Array<{ oldText?: string; newText?: string }> =
        (event.input as { edits?: Array<{ oldText?: string; newText?: string }> }).edits ?? [];

      for (const edit of edits) {
        if (containSecrets(edit.newText ?? "")) {
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
