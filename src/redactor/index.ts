import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { containsGeneratedText, redactGeneratedText } from "./redact.js";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, _ctx) => {
    if (isToolCallEventType("write", event) && containsGeneratedText(event.input.content ?? "")) {
      return { block: true, reason: "Generated text cannot be written" };
    }

    if (isToolCallEventType("edit", event)) {
      for (const edit of (event.input as { edits?: Array<{ newText?: string }> }).edits ?? []) {
        if (containsGeneratedText(edit.newText ?? "")) {
          return { block: true, reason: "Generated text cannot be written" };
        }
      }
    }
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "read" && event.toolName !== "bash" && event.toolName !== "grep") return;

    const content = event.content.map((block) =>
      block.type === "text" ? { ...block, text: redactGeneratedText(block.text) } : block,
    );

    return { details: event.details, isError: event.isError, content };
  });
}
