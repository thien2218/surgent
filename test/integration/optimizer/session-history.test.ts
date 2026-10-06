import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { assistantMessage } from "../../helpers/commands.js";
import { appendTool, settleOptimizer } from "../../helpers/optimizer.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "surgent-history-"));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  vi.stubEnv("PI_OFFLINE", "1");
  return root;
}

describe("canonical optimizer history", () => {
  it("preserves raw history and branch-local reductions across resume, tree navigation, and fork", async () => {
    const cwd = workspace();
    const sessions = join(cwd, "sessions");
    const manager = SessionManager.create(cwd, sessions);
    manager.appendMessage({ role: "user", content: "request", timestamp: 0 });
    const failed = appendTool(manager, "failed", "read", "missing file", { path: "file.ts" }, true);
    const old = appendTool(manager, "old", "read", "source line", { path: "file.ts" });
    const sibling = manager.appendMessage(assistantMessage("sibling reply"));
    manager.branch(old.resultId);
    appendTool(manager, "new", "read", "source line", { path: "file.ts" });
    const grep = appendTool(manager, "grep", "grep", "file.ts\n1: source line");
    manager.appendLabelChange(failed.resultId, "bookmark");
    const beforeEdits = manager.getLeafId()!;
    const raw = structuredClone(manager.getEntries());
    const originalContext = manager.buildSessionProjection().messages;
    const file = manager.getSessionFile()!;
    const prefix = readFileSync(file);

    await settleOptimizer(manager);
    const optimizedLeaf = manager.getLeafId()!;
    const optimized = manager.buildSessionProjection().messages;

    expect(readFileSync(file).subarray(0, prefix.length)).toEqual(prefix);
    expect(manager.getEntries().slice(0, raw.length)).toEqual(raw);
    expect(optimized.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep"]);
    expect(optimized).toContainEqual(expect.objectContaining({ toolCallId: "grep", content: [{ type: "text", text: "file.ts: lines_matched=[1]" }] }));

    const reopened = SessionManager.open(file, sessions, cwd);
    expect(reopened.buildSessionProjection().messages).toEqual(optimized);
    expect(reopened.getLabel(failed.resultId)).toBe("bookmark");
    for (const entry of raw) expect(reopened.getEntry(entry.id)).toEqual(entry);
    expect(await settleOptimizer(reopened)).toBeUndefined();

    reopened.branch(beforeEdits);
    expect(reopened.buildSessionProjection().messages).toEqual(originalContext);
    reopened.branch(sibling);
    expect(reopened.buildSessionProjection().messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["failed", "old"]);
    reopened.branch(optimizedLeaf);
    expect(reopened.buildSessionProjection().messages).toEqual(optimized);

    const forkFile = reopened.createBranchedSession(optimizedLeaf)!;
    const fork = SessionManager.open(forkFile, sessions, cwd);
    expect(fork.buildSessionProjection().messages).toEqual(optimized);
    expect(fork.getEntry(grep.resultId)).toEqual(manager.getEntry(grep.resultId));
    expect(fork.getEntry(old.resultId)).toEqual(manager.getEntry(old.resultId));
    fork.branch(grep.resultId);
    expect(fork.buildSessionProjection().messages).toEqual(originalContext);
  });

  it("keeps compaction boundaries intact when their first retained calls are omitted", async () => {
    const manager = SessionManager.inMemory(workspace());
    const hidden = appendTool(manager, "hidden", "read", "source", { path: "file.ts" });
    const old = appendTool(manager, "old", "read", "source", { path: "file.ts" });
    const compactId = manager.appendCompaction("previous summary", old.callId, 100);
    appendTool(manager, "new", "read", "source", { path: "file.ts" });
    const raw = structuredClone(manager.getEntries());

    const result = await settleOptimizer(manager);

    expect(result?.entries).toEqual([
      { type: "context_edit", targetId: old.resultId, replacement: null },
      { type: "context_edit", targetId: old.callId, replacement: null },
    ]);
    expect(manager.getEntry(compactId)).toMatchObject({ firstKeptEntryId: old.callId, summary: "previous summary" });
    expect(manager.getEntries().slice(0, raw.length)).toEqual(raw);
    expect(manager.buildSessionProjection().entries.find((entry) => entry.sourceEntry.id === hidden.resultId)).toBeUndefined();
    expect(manager.buildSessionProjection().messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new"]);
    expect(manager.buildSessionProjection().messages.some((message) => message.role === "compactionSummary")).toBe(true);
  });

  it("passes paired omissions and grep summaries into native compaction, not raw tool output", async () => {
    const cwd = workspace();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in optimizer integration test"); }));
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const manager = SessionManager.inMemory(cwd);
    manager.appendMessage({ role: "user", content: "inspect source", timestamp: 0 });
    appendTool(manager, "old", "read", "first\nsecond", { path: "file.ts" });
    appendTool(manager, "new", "read", "first\nsecond", { path: "file.ts" });
    appendTool(manager, "grep", "grep", "file.ts\n1: long raw grep source");
    manager.appendMessage(assistantMessage("finished"));
    manager.appendMessage({ role: "user", content: "next task", timestamp: 0 });
    const settingsManager = SettingsManager.inMemory({ compaction: { keepRecentTokens: 0 } });
    const preparations: SessionBeforeCompactEvent["preparation"][] = [];
    const resourceLoader = new DefaultResourceLoader({
      cwd, agentDir: cwd, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi) => {
        pi.on("session_before_compact", (event) => {
          preparations.push(event.preparation);
          return { cancel: true };
        });
      }],
    });
    await resourceLoader.reload();
    const model: Model<"openai-completions"> = {
      id: "test-model", name: "Test model", api: "openai-completions", provider: "test-provider",
      baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000,
    };
    const { session } = await createAgentSession({
      cwd, agentDir: cwd, model, noTools: "all", sessionManager: manager, settingsManager, resourceLoader,
    });
    onTestFinished(() => session.dispose());
    await expect(session.compact()).rejects.toThrow("Compaction cancelled");
    await settleOptimizer(manager);
    await expect(session.compact()).rejects.toThrow("Compaction cancelled");

    expect(preparations).toHaveLength(2);
    const before = [...preparations[0]!.messagesToSummarize, ...preparations[0]!.turnPrefixMessages];
    const after = [...preparations[1]!.messagesToSummarize, ...preparations[1]!.turnPrefixMessages];
    expect(before.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "new", "grep"]);
    expect(after.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep"]);
    expect(after.filter((message) => message.role === "assistant").flatMap((message) => message.content.filter((block) => block.type === "toolCall").map((block) => block.id))).toEqual(["new", "grep"]);
    expect(after).toContainEqual(expect.objectContaining({ toolCallId: "grep", content: [{ type: "text", text: "file.ts: lines_matched=[1]" }] }));
  });
});
