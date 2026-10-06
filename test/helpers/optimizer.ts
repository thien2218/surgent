import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type AgentBeforeSettleEvent,
  type AgentBeforeSettleEventResult,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import optimizerContext from "../../src/optimizer/context.js";
import { assistantMessage, commandContext } from "./commands.js";
import { recordExtension } from "./extension.js";

export function appendTool(
  manager: SessionManager,
  toolCallId: string,
  toolName: string,
  text: string,
  args: ToolCall["arguments"] = {},
  isError = false,
) {
  const assistant = assistantMessage("");
  assistant.content = [{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }];
  const callId = manager.appendMessage(assistant);
  const message: ToolResultMessage = {
    role: "toolResult", toolCallId, toolName, isError, timestamp: 0,
    content: [{ type: "text", text }],
  };
  const resultId = manager.appendMessage(message);
  return { callId, resultId };
}

export function boundaryEvent(manager: SessionManager): AgentBeforeSettleEvent {
  const projection = manager.buildSessionProjection();
  return {
    type: "agent_before_settle", outcome: "completed", entries: [], continue: false,
    context: {
      contextEntries: projection.entries, contextMessages: projection.messages,
      llmMessages: convertToLlm(projection.messages), pendingMessages: [], canContinue: true,
    },
  };
}

export async function settleOptimizer(manager: SessionManager) {
  const pi = recordExtension();
  optimizerContext(pi.api);
  const { ctx } = commandContext(manager.getCwd());
  const result = await pi.event("agent_before_settle")(
    boundaryEvent(manager), { ...ctx, sessionManager: manager },
  ) as AgentBeforeSettleEventResult | undefined;
  for (const draft of result?.entries ?? []) {
    if (draft.type !== "context_edit") throw new Error(`Unexpected optimizer draft: ${draft.type}`);
    manager.appendContextEdit(draft.targetId, draft.replacement);
  }
  return result;
}
