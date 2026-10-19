import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../utils.js";

const RETAINED_TOOLS = new Set(["codemode", "subagent"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

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

/** Failed shell calls whose exact command executed again later. */
export function getRetriedCalls(entries: ProjectedSessionEntry[]): Set<string> {
  const commands = new Map<string, string>();
  for (const { messages } of entries) {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type !== "toolCall" || !SHELL_TOOLS.has(block.name)) continue;
        const { command } = block.arguments;
        if (typeof command === "string") commands.set(block.id, `${block.name}:${command.trim()}`);
      }
    }
  }

  const retriedCalls = new Set<string>();
  const laterRuns = new Set<string>();
  for (const { messages } of entries.toReversed()) {
    const message = messages[0];
    if (messages.length !== 1 || message?.role !== "toolResult") continue;

    const command = commands.get(message.toolCallId);
    if (!command || message.durationMs === undefined) continue;
    if (message.isError && laterRuns.has(command)) retriedCalls.add(message.toolCallId);
    laterRuns.add(command);
  }

  return retriedCalls;
}

export function shouldRemoveToolCall(
  message: ToolResultMessage,
  retriedCalls: ReadonlySet<string>,
): boolean {
  if (typeof message.toolCallId !== "string") return false;
  if (!message.isError) return hasEmptyResult(message);
  if (isBlocked(message) || RETAINED_TOOLS.has(message.toolName)) return false;
  return !SHELL_TOOLS.has(message.toolName) || retriedCalls.has(message.toolCallId);
}
