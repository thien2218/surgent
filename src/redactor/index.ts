import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { containSecrets } from "./secrets.js";
import { block, structured } from "./results.js";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (isToolCallEventType("write", event) && containSecrets(event.input.content)) {
      return { block: true, reason: "Secrets detected in content to be written" };
    } else if (
      isToolCallEventType("edit", event) &&
      event.input.edits.some((edit) => containSecrets(edit.newText))
    ) {
      return { block: true, reason: "Secrets detected in edit content" };
    }
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (!["read", "bash", "grep", "powershell", "codemode"].includes(event.toolName)) {
      return;
    }

    try {
      // Keep Pi content types and opaque image bytes; sanitize text and metadata.
      const content = event.content.map((item) => block(item) as unknown as typeof item);
      return {
        content,
        ...(event.structuredContent === undefined ? {} : { structuredContent: structured(event) }),
        details: event.details,
        isError: event.isError,
        ...(event.usage === undefined ? {} : { usage: event.usage }),
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: "Tool result rejected: cannot safely redact supported result data.",
          },
        ],
        details: event.details,
        isError: true,
        ...(event.usage === undefined ? {} : { usage: event.usage }),
      };
    }
  });
}
