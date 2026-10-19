import { SessionManager } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import { assistantMessage } from "../../helpers/commands.js";
import { appendTool, blockTool, startPruner } from "../../helpers/optimizer.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;
beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-context-contract-" });
});

/** Appends a model reply, so every earlier result counts as seen. */
function reply(manager: SessionManager) {
  return manager.appendMessage(assistantMessage("done"));
}

describe("optimizer session start", () => {
  it("leaves sessions without model replies unchanged", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    expect(await startPruner(manager)).toBeUndefined();

    manager.appendMessage({ role: "user", content: "request", timestamp: 0 });
    expect(await startPruner(manager, "resume")).toBeUndefined();
    expect(manager.getEntries().some((entry) => entry.type === "context_edit")).toBe(false);
  });

  it("strips calls from projected assistant content and skips results it already edited", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const old = appendTool(manager, "old", "find", "No files found matching pattern");
    reply(manager);
    const content = [
      { type: "text" as const, text: "external explanation" },
      { type: "toolCall" as const, id: "old", name: "find", arguments: {} },
    ];
    manager.appendContextEdit(old.callId, { content });

    expect(await startPruner(manager)).toEqual([
      { type: "context_edit", targetId: old.resultId, replacement: null },
      { type: "context_edit", targetId: old.callId, replacement: { content: [content[0]] } },
    ]);
    expect(await startPruner(manager, "resume")).toBeUndefined();
  });

  it("prunes seen grep context at session start while preserving matches, headers, notices, and tool calls", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const text = [
      "src/first.ts",
      "1- before",
      "2- before",
      "3- before",
      "4: match containing 12- text",
      "5- after",
      "6- ",
      "7- after",
      "8: another match",
      "",
      "src/second.ts",
      "20- before",
      "21: second file match",
      "22- after",
      "[100 matches limit reached. Use limit=200 for more, or refine pattern]",
    ].join("\n");
    const expected = [
      "src/first.ts",
      "4: match containing 12- text",
      "8: another match",
      "",
      "src/second.ts",
      "21: second file match",
      "[100 matches limit reached. Use limit=200 for more, or refine pattern]",
    ].join("\n");
    const args = { pattern: "match", context: 3 };
    const details = { matchLimitReached: true, linesTruncated: false };
    const { resultId } = appendTool(manager, "grep", "grep", text, args, false, details);

    expect(await startPruner(manager)).toBeUndefined();
    reply(manager);
    const original = structuredClone(manager.getEntries());
    const result = await startPruner(manager, "resume");

    expect(result).toEqual([
      { type: "context_edit", targetId: resultId, replacement: { content: [{ type: "text", text: expected }] } },
    ]);
    expect(manager.buildSessionProjection().messages).toMatchObject([
      { role: "assistant", content: [{ type: "toolCall", id: "grep", name: "grep", arguments: args }] },
      { role: "toolResult", toolCallId: "grep", toolName: "grep", isError: false, content: [{ type: "text", text: expected }], details },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
    expect(manager.getEntries().slice(0, original.length)).toEqual(original);
    expect(await startPruner(manager, "resume")).toBeUndefined();
  });

  it("removes failures only after the model has replied to them", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const seen = appendTool(manager, "seen", "read", "failure", {}, true);
    const current = appendTool(manager, "current", "read", "failure", {}, true);

    expect(await startPruner(manager)).toEqual([
      { type: "context_edit", targetId: seen.resultId, replacement: null },
      { type: "context_edit", targetId: seen.callId, replacement: null },
    ]);
    expect(manager.buildSessionProjection().messages.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
    reply(manager);
    expect(await startPruner(manager, "resume")).toEqual([
      { type: "context_edit", targetId: current.resultId, replacement: null },
      { type: "context_edit", targetId: current.callId, replacement: null },
    ]);
  });

  it("leaves context-free grep results and other successful tool output unchanged", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    appendTool(manager, "matches", "grep", "file.ts\n1: match");
    appendTool(manager, "empty", "grep", "No matches found");
    appendTool(manager, "bash", "bash", "1- command output");
    reply(manager);
    const original = structuredClone(manager.getEntries());

    expect(await startPruner(manager)).toBeUndefined();
    expect(manager.getEntries()).toEqual(original);
  });

  it("removes failed grep exchanges instead of keeping reduced error output", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const { callId, resultId } = appendTool(manager, "failed", "grep", "file.ts\n1- context\n2: failure", {}, true);
    reply(manager);

    expect(await startPruner(manager)).toEqual([
      { type: "context_edit", targetId: resultId, replacement: null },
      { type: "context_edit", targetId: callId, replacement: null },
    ]);
    expect(manager.buildSessionProjection().messages.map((message) => message.role)).toEqual(["assistant"]);
  });

  it("keeps seen calls blocked before execution, including retried shell commands", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    blockTool(manager, "read", "read", "User rejected this tool call. User input: use the fixture", { path: "file.ts" });
    blockTool(manager, "bash", "bash", "Access to this resource is denied by policy rule: deny", { command: "rm -rf dist" });
    appendTool(manager, "retry", "bash", "removed", { command: "rm -rf dist" });
    reply(manager);
    const original = structuredClone(manager.getEntries());

    expect(await startPruner(manager)).toBeUndefined();
    expect(manager.getEntries()).toEqual(original);
  });

  it("leaves duplicate inspections unchanged at session start even with earlier omissions", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    appendTool(manager, "old", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, null);
    const newer = appendTool(manager, "new", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, null);
    reply(manager);

    expect(await startPruner(manager)).toBeUndefined();
    manager.appendContextEdit(newer.resultId, null);
    expect(await startPruner(manager, "resume")).toBeUndefined();
  });

  it("prunes paired empty results while preserving duplicate inspections and other assistant content", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("keep explanation");
    assistant.content.unshift({ type: "thinking", thinking: "valid reasoning", thinkingSignature: "signature" });
    assistant.content.push(
      { type: "toolCall", id: "old", name: "inspect", arguments: { path: "file.ts", symbol: "handler" } },
      { type: "toolCall", id: "empty", name: "find", arguments: {} },
      { type: "toolCall", id: "keep", name: "bash", arguments: {} },
    );
    const callId = manager.appendMessage(assistant);
    manager.appendMessage({ role: "toolResult", toolCallId: "old", toolName: "inspect", details: null, content: [{ type: "text", text: "source" }], isError: false, timestamp: 0 });
    const emptyId = manager.appendMessage({ role: "toolResult", toolCallId: "empty", toolName: "find", content: [{ type: "text", text: "No files found matching pattern" }], isError: false, timestamp: 0 });
    manager.appendMessage({ role: "toolResult", toolCallId: "keep", toolName: "bash", content: [{ type: "text", text: "exit 1" }], isError: true, timestamp: 0 });
    appendTool(manager, "new", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, null);

    const result = await startPruner(manager);

    expect(result).toEqual([
      { type: "context_edit", targetId: emptyId, replacement: null },
      { type: "context_edit", targetId: callId, replacement: { content: [assistant.content[0], assistant.content[1], assistant.content[2], assistant.content[4]] } },
    ]);
    const messages = manager.buildSessionProjection().messages;
    expect(messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "keep", "new"]);
  });

  it.each([false, true])("omits assistants left without meaningful content (thinking=%s)", async (thinking) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("");
    if (thinking) assistant.content.push({ type: "thinking", thinking: "reasoning" });
    assistant.content.push({ type: "toolCall", id: "failed", name: "read", arguments: {} });
    const callId = manager.appendMessage(assistant);
    const resultId = manager.appendMessage({ role: "toolResult", toolCallId: "failed", toolName: "read", content: [{ type: "text", text: "failure" }], isError: true, timestamp: 0, durationMs: 0 });
    reply(manager);

    expect(await startPruner(manager)).toEqual([
      { type: "context_edit", targetId: resultId, replacement: null },
      { type: "context_edit", targetId: callId, replacement: null },
    ]);
    expect(manager.buildSessionProjection().messages.map((message) => message.role)).toEqual(["assistant"]);
    expect(await startPruner(manager, "resume")).toBeUndefined();
    expect(manager.getSessionFile()).toBeUndefined();
  });

  it("never retargets an existing omission of an empty result onto its assistant parent", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const assistant = assistantMessage("surviving explanation");
    assistant.content.push({ type: "toolCall", id: "empty", name: "find", arguments: {} });
    const callId = manager.appendMessage(assistant);
    const resultId = manager.appendMessage({ role: "toolResult", toolCallId: "empty", toolName: "find", content: [{ type: "text", text: "No files found matching pattern" }], isError: false, timestamp: 0 });
    reply(manager);
    const editId = manager.appendContextEdit(resultId, null);
    const original = structuredClone(manager.getEntries());

    expect(await startPruner(manager)).toBeUndefined();
    expect(manager.getEntries()).toEqual(original);
    expect(manager.getEntry(editId)).toMatchObject({ targetId: resultId, replacement: null });
    expect(manager.buildSessionProjection().entries.find((entry) => entry.sourceEntry.id === callId)?.messages).toEqual([assistant]);
  });
});
