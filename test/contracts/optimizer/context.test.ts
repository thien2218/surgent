import {
  SessionManager,
  type AgentBeforeSettleEventResult,
  type ContextEditEntryDraft,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import optimizerContext from "../../../src/optimizer/context.js";
import { assistantMessage, commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { appendTool, boundaryEvent, settleOptimizer } from "../../helpers/optimizer.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;
beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-context-contract-" });
});

function loadContext(manager: SessionManager) {
  const pi = recordExtension();
  optimizerContext(pi.api);
  const { ctx } = commandContext(workspace.cwd);
  return { handler: pi.event("agent_before_settle"), ctx: { ...ctx, sessionManager: manager } };
}

describe("optimizer settle boundary", () => {
  it.each(["aborted", "error"] as const)("does not reduce current results after %s", async (outcome) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    appendTool(manager, "old", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    appendTool(manager, "new", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    appendTool(manager, "empty", "find", "No files found matching pattern");
    appendTool(manager, "grep", "grep", "file.ts\n1: source");
    const { handler, ctx } = loadContext(manager);
    const event = { ...boundaryEvent(manager), outcome };
    const original = structuredClone(event);

    expect(await handler(event, ctx)).toBeUndefined();
    expect(event).toEqual(original);
  });

  it.each([false, true])("preserves earlier drafts, projected assistant content, and continue=%s", async (continuation) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const old = appendTool(manager, "old", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    appendTool(manager, "new", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const { handler, ctx } = loadContext(manager);
    const preview = SessionManager.inMemory(workspace.cwd, undefined, manager.getEntries());
    const content = [
      { type: "text" as const, text: "external explanation" },
      { type: "toolCall" as const, id: "old", name: "inspect", arguments: { path: "file.ts", symbol: "handler" } },
    ];
    const prior: ContextEditEntryDraft = {
      type: "context_edit", targetId: old.callId, replacement: { content },
    };
    preview.appendContextEdit(prior.targetId, prior.replacement);
    const event = { ...boundaryEvent(preview), entries: [prior], continue: continuation };
    const original = structuredClone(event);

    const result = await handler(event, ctx) as AgentBeforeSettleEventResult;

    expect(result.continue).toBe(continuation);
    expect(result.entries).toEqual([
      prior,
      { type: "context_edit", targetId: old.resultId, replacement: null },
      { type: "context_edit", targetId: old.callId, replacement: { content: [content[0]] } },
    ]);
    expect(event).toEqual(original);
    for (const draft of result.entries ?? []) {
      if (draft.type === "context_edit") preview.appendContextEdit(draft.targetId, draft.replacement);
    }
    expect(await handler(boundaryEvent(preview), ctx)).toBeUndefined();
    expect(manager.getEntries().some((entry) => entry.type === "context_edit")).toBe(false);
  });

  it("does not use an inspect identity omitted by an earlier handler's draft", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    appendTool(manager, "old", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const newer = appendTool(manager, "new", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const { handler, ctx } = loadContext(manager);
    const preview = SessionManager.inMemory(workspace.cwd, undefined, manager.getEntries());
    const prior: ContextEditEntryDraft = { type: "context_edit", targetId: newer.resultId, replacement: null };
    preview.appendContextEdit(prior.targetId, prior.replacement);

    expect(await handler({ ...boundaryEvent(preview), entries: [prior] }, ctx)).toBeUndefined();
  });

  it("composes pruning and dedup removals on one assistant without losing other content", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("keep explanation");
    assistant.content.unshift({ type: "thinking", thinking: "valid reasoning", thinkingSignature: "signature" });
    assistant.content.push(
      { type: "toolCall", id: "old", name: "inspect", arguments: { path: "file.ts", symbol: "handler" } },
      { type: "toolCall", id: "empty", name: "find", arguments: {} },
      { type: "toolCall", id: "keep", name: "bash", arguments: {} },
    );
    const callId = manager.appendMessage(assistant);
    const oldId = manager.appendMessage({ role: "toolResult", toolCallId: "old", toolName: "inspect", details: { path: "file.ts", symbol: "handler" }, content: [{ type: "text", text: "source" }], isError: false, timestamp: 0 });
    const emptyId = manager.appendMessage({ role: "toolResult", toolCallId: "empty", toolName: "find", content: [{ type: "text", text: "No files found matching pattern" }], isError: false, timestamp: 0 });
    manager.appendMessage({ role: "toolResult", toolCallId: "keep", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true, timestamp: 0 });
    appendTool(manager, "new", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });

    const result = await settleOptimizer(manager);

    expect(result?.entries).toEqual([
      { type: "context_edit", targetId: oldId, replacement: null },
      { type: "context_edit", targetId: emptyId, replacement: null },
      { type: "context_edit", targetId: callId, replacement: { content: [assistant.content[0], assistant.content[1], assistant.content[4]] } },
    ]);
    const messages = manager.buildSessionProjection().messages;
    expect(messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["keep", "new"]);
  });

  it.each([false, true])("omits assistants left without meaningful content (thinking=%s)", async (thinking) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("");
    if (thinking) assistant.content.push({ type: "thinking", thinking: "reasoning" });
    assistant.content.push({ type: "toolCall", id: "failed", name: "read", arguments: {} });
    const callId = manager.appendMessage(assistant);
    const resultId = manager.appendMessage({ role: "toolResult", toolCallId: "failed", toolName: "read", content: [{ type: "text", text: "failure" }], isError: true, timestamp: 0 });

    expect((await settleOptimizer(manager))?.entries).toEqual([
      { type: "context_edit", targetId: resultId, replacement: null },
      { type: "context_edit", targetId: callId, replacement: null },
    ]);
    expect(manager.buildSessionProjection().messages).toEqual([]);
    expect(await settleOptimizer(manager)).toBeUndefined();
    expect(manager.getSessionFile()).toBeUndefined();
  });

  it("never retargets an existing omission of an empty result onto its assistant parent", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("surviving explanation");
    assistant.content.push({ type: "toolCall", id: "empty", name: "find", arguments: {} });
    const callId = manager.appendMessage(assistant);
    const resultId = manager.appendMessage({ role: "toolResult", toolCallId: "empty", toolName: "find", content: [{ type: "text", text: "No files found matching pattern" }], isError: false, timestamp: 0 });
    const editId = manager.appendContextEdit(resultId, null);
    const original = structuredClone(manager.getEntries());

    expect(await settleOptimizer(manager)).toBeUndefined();
    expect(manager.getEntries()).toEqual(original);
    expect(manager.getEntry(editId)).toMatchObject({ targetId: resultId, replacement: null });
    expect(manager.buildSessionProjection().entries.find((entry) => entry.sourceEntry.id === callId)?.messages).toEqual([assistant]);
  });
});
