import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  ContextEditEntryDraft,
  ContextEvent,
  ContextEventResult,
  ExtensionContext,
  SessionManager,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import pruner from "../../src/optimizer/pruner/index.js";
import deduplicator from "../../src/optimizer/deduplicator/index.js";
import { assistantMessage, commandContext } from "./commands.js";
import { recordExtension } from "./extension.js";

export function appendTool(
  manager: SessionManager,
  toolCallId: string,
  toolName: string,
  text: string,
  args: ToolCall["arguments"] = {},
  isError = false,
  details?: ToolResultMessage["details"],
) {
  const assistant = assistantMessage("");
  assistant.content = [{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }];
  const callId = manager.appendMessage(assistant);
  const message: ToolResultMessage = {
    role: "toolResult", toolCallId, toolName, isError, details, timestamp: 0,
    content: [{ type: "text", text }],
  };
  const resultId = manager.appendMessage(message);
  return { callId, resultId };
}

export async function startDeduplicator(manager: SessionManager, reason: SessionStartEvent["reason"] = "startup") {
  const pi = recordExtension();
  deduplicator(pi.api);
  const { ctx } = commandContext(manager.getCwd());
  const context: ExtensionContext = { ...ctx, sessionManager: manager };
  await pi.event("session_start")({ type: "session_start", reason }, context);
  return {
    pi,
    ctx: context,
    async request(messages: ContextEvent["messages"] = manager.buildSessionProjection().messages) {
      const result = await pi.event("context")({ type: "context", messages }, context) as ContextEventResult | undefined;
      return result?.messages ?? messages;
    },
  };
}

/** Starts the pruner and returns the context edits it appended, if any. */
export async function startPruner(manager: SessionManager, reason: SessionStartEvent["reason"] = "startup") {
  const pi = recordExtension();
  pruner(pi.api);
  const { ctx } = commandContext(manager.getCwd());
  const count = manager.getEntries().length;
  await pi.event("session_start")({ type: "session_start", reason }, { ...ctx, sessionManager: manager });
  const edits = manager.getEntries().slice(count).map((entry): ContextEditEntryDraft => {
    if (entry.type !== "context_edit") throw new Error(`Unexpected pruner entry: ${entry.type}`);
    return { type: "context_edit", targetId: entry.targetId, replacement: entry.replacement };
  });
  if (edits.length > 0) return edits;
}
