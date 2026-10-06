import { isRecord } from "../../utils.js";

function hasEmptyResult(message: {
  content?: unknown;
  toolName?: unknown;
}): boolean {
  if (message.toolName !== "ls" && message.toolName !== "find") {
    return false;
  }

  if (!Array.isArray(message.content) || message.content.length !== 1) return false;
  const content = message.content[0];
  if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") return false;

  return (
    content.text === "(empty directory)" ||
    content.text === "No files found matching pattern" ||
    content.text === "No changes found." ||
    content.text === "No changes in selected files."
  );
}

export function getRemovedToolCallId(message: {
  content?: unknown;
  isError?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
}): string | undefined {
  if (typeof message.toolCallId !== "string") return;
  if (message.isError === true) return message.toolName === "bash" ? undefined : message.toolCallId;
  return hasEmptyResult(message) ? message.toolCallId : undefined;
}
