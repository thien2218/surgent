import { SessionManager, type AgentBeforeSettleEventResult, type ContextEditEntryDraft } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import compactorExtension from "../../../src/optimizer/compactor/index.js";
import { recordExtension } from "../../helpers/extension.js";
import { appendTool, boundaryEvent, settleOptimizer } from "../../helpers/optimizer.js";
import { commandContext } from "../../helpers/commands.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;
beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-compactor-contract-", changeCwd: true });
});

it("registers only settlement, not execution tools", () => {
  const pi = recordExtension();
  compactorExtension(pi.api);

  expect(() => pi.tool("bash")).toThrow("Missing tool registration");
  expect(() => pi.tool("grep")).toThrow("Missing tool registration");
  expect(pi.event("agent_before_settle")).toBeTypeOf("function");
});

describe("canonical grep summaries", () => {
  it.each(["aborted", "error"] as const)("leaves grep untouched after %s settlement", async (outcome) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    appendTool(manager, "grep", "grep", "src/file.ts\n7: full source");
    const pi = recordExtension();
    compactorExtension(pi.api);
    const { ctx } = commandContext(workspace.cwd);
    const event = { ...boundaryEvent(manager), outcome };
    const original = structuredClone(event);

    expect(await pi.event("agent_before_settle")(event, ctx)).toBeUndefined();
    expect(event).toEqual(original);
  });

  it.each([false, true])("preserves incoming drafts and continue=%s", async (continuation) => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const external = appendTool(manager, "external", "grep", "src/external.ts\n1: source");
    const grep = appendTool(manager, "grep", "grep", "src/file.ts\n7: source");
    appendTool(manager, "failed", "grep", "src/file.ts\n8: failed source", {}, true);
    const prior: ContextEditEntryDraft = {
      type: "context_edit", targetId: external.resultId, replacement: { content: "src/external.ts\n2: external replacement" },
    };
    const preview = SessionManager.inMemory(workspace.cwd, undefined, manager.getEntries());
    preview.appendContextEdit(prior.targetId, prior.replacement);
    const pi = recordExtension();
    compactorExtension(pi.api);
    const { ctx } = commandContext(workspace.cwd);
    const event = { ...boundaryEvent(preview), entries: [prior], continue: continuation };
    const original = structuredClone(event);

    const result = await pi.event("agent_before_settle")(event, ctx) as AgentBeforeSettleEventResult;

    expect(result).toEqual({ continue: continuation, entries: [prior, {
      type: "context_edit", targetId: grep.resultId,
      replacement: { content: [{ type: "text", text: "src/file.ts: lines_matched=[7]" }] },
    }] });
    expect(event).toEqual(original);
  });
  it("keeps source during the task and summarizes only direct grep results at successful settle", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const grep = appendTool(manager, "grep", "grep", "src/file.ts\n7: full source\n8- context");
    appendTool(manager, "empty", "grep", "No matches found");
    const nestedText = "src/file.ts\n9: nested source\n\n[truncated]";
    manager.appendMessage({
      role: "toolResult", toolCallId: "nested", toolName: "codemode", isError: false, timestamp: 0,
      content: [{ type: "text", text: nestedText }],
      details: { path: "src/file.ts", symbol: "example", startLine: 1, endLine: 100 },
      nestedCalls: { complete: false, calls: [{ id: "nested/1", name: "read", status: "ok", durationMs: 1 }] },
    });
    appendTool(manager, "bash", "bash", "src/file.ts\n10: bash output");
    const raw = structuredClone(manager.getEntries());

    expect(manager.buildSessionProjection().messages).toContainEqual(
      expect.objectContaining({ toolCallId: "grep", content: [{ type: "text", text: "src/file.ts\n7: full source\n8- context" }] }),
    );
    const result = await settleOptimizer(manager);

    expect(result).toEqual({ continue: false, entries: [{
      type: "context_edit", targetId: grep.resultId,
      replacement: { content: [{ type: "text", text: "src/file.ts: lines_matched=[7]" }] },
    }] });
    expect(manager.buildSessionProjection().messages).toContainEqual(
      expect.objectContaining({ toolCallId: "grep", content: [{ type: "text", text: "src/file.ts: lines_matched=[7]" }] }),
    );
    expect(manager.buildSessionProjection().messages).toContainEqual(
      expect.objectContaining({ toolCallId: "nested", content: [{ type: "text", text: nestedText }] }),
    );
    expect(manager.getEntries().slice(0, raw.length)).toEqual(raw);
    expect(await settleOptimizer(manager)).toBeUndefined();
  });

  it("does not summarize stale raw grep text after another extension replaces it", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const grep = appendTool(manager, "grep", "grep", "src/file.ts\n7: raw source");
    manager.appendContextEdit(grep.resultId, { content: "src/other.ts\n5: external content" });

    expect(await settleOptimizer(manager)).toBeUndefined();
    expect(manager.buildSessionProjection().messages).toContainEqual(
      expect.objectContaining({ toolCallId: "grep", content: [{ type: "text", text: "src/other.ts\n5: external content" }] }),
    );
  });
});
