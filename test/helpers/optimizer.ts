import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  createExtensionRuntime,
  ExtensionRunner,
  SessionManager,
  type AgentBeforeSettleEvent,
  type Extension,
  type ExtensionContext,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import pruner from "../../src/optimizer/pruner/index.js";
import { assistantMessage } from "./commands.js";
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
  const extensions: Extension[] = [pruner].map((factory) => {
    const pi = recordExtension();
    factory(pi.api);
    return {
      path: factory.name, resolvedPath: factory.name,
      sourceInfo: { path: factory.name, source: "test", scope: "temporary", origin: "top-level" },
      handlers: new Map([["agent_before_settle", [async (...args: unknown[]) =>
        pi.event("agent_before_settle")(args[0] as AgentBeforeSettleEvent, args[1] as ExtensionContext),
      ]]]),
      tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map(),
    };
  });
  const registry = new Proxy({} as ModelRegistry, {
    get(_target, property) { throw new Error(`Unexpected model registry access: ${String(property)}`); },
  });
  const runner = new ExtensionRunner(extensions, createExtensionRuntime(), manager.getCwd(), manager, registry);
  const errors: string[] = [];
  runner.onError((error) => { errors.push(error.error); });
  const result = await runner.emitBoundary({ type: "agent_before_settle", outcome: "completed" }, (drafts) => {
    const preview = SessionManager.inMemory(manager.getCwd(), undefined, manager.getEntries());
    const leafId = manager.getLeafId();
    if (leafId === null) preview.resetLeaf();
    else preview.branch(leafId);
    for (const draft of drafts) {
      if (draft.type !== "context_edit") throw new Error(`Unexpected optimizer draft: ${draft.type}`);
      preview.appendContextEdit(draft.targetId, draft.replacement);
    }
    return boundaryEvent(preview).context;
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (!result.valid) throw new Error("Invalid optimizer boundary");
  for (const draft of result.entries) {
    if (draft.type !== "context_edit") throw new Error(`Unexpected optimizer draft: ${draft.type}`);
    manager.appendContextEdit(draft.targetId, draft.replacement);
  }
  if (result.entries.length === 0) return;
  return { entries: result.entries, continue: result.continue };
}
