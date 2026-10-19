import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { isRecord } from "../../utils.js";

const RETAINED_TOOLS = new Set(["bash", "powershell", "codemode", "subagent"]);

// Errors the agent loop raises itself before a call runs, as opposed to extension blocks.
const LOOP_ERRORS = [
  /^Tool "?[^"\s]+"? not found$/,
  /^Validation failed for tool "/,
  /^Invalid arguments for tool "/,
  /^Operation aborted$/,
  /^Tool call "[^"]+" was not executed: /,
];

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

/** Pi stamps `durationMs` only on executed calls, so other errors are blocks unless the loop raised them. */
function isBlocked(message: ToolResultMessage): boolean {
  if (!message.isError || message.durationMs !== undefined) return false;
  const [content] = message.content;
  if (message.content.length !== 1 || content?.type !== "text") return true;
  return !LOOP_ERRORS.some((pattern) => pattern.test(content.text));
}

export function shouldRemoveToolCall(message: ToolResultMessage): boolean {
  if (typeof message.toolCallId !== "string") return false;
  if (!message.isError) return hasEmptyResult(message);
  return !isBlocked(message) && !RETAINED_TOOLS.has(message.toolName);
}
