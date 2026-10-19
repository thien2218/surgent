import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { isRecord } from "../../utils.js";

const RETAINED_TOOLS = new Set(["bash", "powershell", "codemode", "subagent"]);

function hasEmptyResult(message: { content?: unknown; toolName?: unknown }): boolean {
  if (
    (message.toolName !== "ls" && message.toolName !== "find") ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  ) {
    return false;
  }

  const content = message.content[0];
  if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") {
    return false;
  }

  return (
    content.text === "(empty directory)" ||
    content.text === "No files found matching pattern" ||
    content.text === "No changes found." ||
    content.text === "No changes in selected files."
  );
}

export function shouldRemoveToolCall(message: {
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
}): boolean {
  if (typeof message.toolCallId !== "string") return false;
  if (message.isError) return !RETAINED_TOOLS.has(message.toolName);
  return hasEmptyResult(message);
}
