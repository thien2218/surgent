import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  createExtensionRuntime,
  ExtensionRunner,
  SessionManager,
  type ContextEvent,
  type ContextEventResult,
  type SessionStartEvent,
  type Extension,
  type ExtensionContext,
  type ModelRegistry,
  type TurnEndEvent,
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

/** Ends a turn whose own results are `toolResultEntryIds`, so only earlier results count as seen. */
function turnEnd(manager: SessionManager, toolResultEntryIds: string[]): Omit<TurnEndEvent, "entries" | "continue" | "context"> {
  return {
    type: "turn_end", turnIndex: 0, message: assistantMessage(""), toolResults: [],
    messageEntryId: manager.getLeafId() ?? "", toolResultEntryIds, outcome: "completed",
  };
}

export function boundaryEvent(manager: SessionManager, toolResultEntryIds: string[] = []): TurnEndEvent {
  const projection = manager.buildSessionProjection();
  return {
    ...turnEnd(manager, toolResultEntryIds), entries: [], continue: false,
    context: {
      contextEntries: projection.entries, contextMessages: projection.messages,
      llmMessages: convertToLlm(projection.messages), pendingMessages: [], canContinue: true,
    },
  };
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

export async function endOptimizerTurn(manager: SessionManager, toolResultEntryIds: string[] = []) {
  const extensions: Extension[] = [pruner].map((factory) => {
    const pi = recordExtension();
    factory(pi.api);
    return {
      path: factory.name, resolvedPath: factory.name,
      sourceInfo: { path: factory.name, source: "test", scope: "temporary", origin: "top-level" },
      handlers: new Map([["turn_end", [async (...args: unknown[]) =>
        pi.event("turn_end")(args[0] as TurnEndEvent, args[1] as ExtensionContext),
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
  const result = await runner.emitBoundary(turnEnd(manager, toolResultEntryIds), (drafts) => {
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
