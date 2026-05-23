import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { containSecrets } from "./secrets.js";

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
    if (event.toolName !== "read") return;

    const text = event.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    if (containSecrets(text)) {
      return {
        content: [{ type: "text", text: "[Secrets detected: content redacted]" }],
        isError: true,
      };
    }
  });
}
