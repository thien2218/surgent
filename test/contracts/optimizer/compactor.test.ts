import { SessionManager } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import compactorExtension from "../../../src/optimizer/compactor/index.js";
import { recordExtension } from "../../helpers/extension.js";
import { appendTool, settleOptimizer } from "../../helpers/optimizer.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;
beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-compactor-contract-", changeCwd: true });
});

it("advertises bash as text-only because redaction replaces structured results", () => {
  const pi = recordExtension();
  compactorExtension(pi.api);
  expect(pi.tool("bash").outputSchema).toBeUndefined();
});

describe("canonical grep summaries", () => {
  it("keeps source during the task and summarizes only direct grep results at successful settle", async () => {
    const manager = SessionManager.inMemory(workspace.cwd);
    const grep = appendTool(manager, "grep", "grep", "src/file.ts\n7: full source\n8- context");
    appendTool(manager, "empty", "grep", "No matches found");
    appendTool(manager, "nested", "codemode", "src/file.ts\n9: nested source");
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
