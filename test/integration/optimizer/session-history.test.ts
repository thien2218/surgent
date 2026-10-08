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
import deduplicator from "../../../src/optimizer/deduplicator/index.js";
import { assistantMessage } from "../../helpers/commands.js";
import { appendTool, settleOptimizer, startDeduplicator } from "../../helpers/optimizer.js";

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
  it("keeps transient snapshots out of JSONL and recomputes them on resume and fork without undoing pruning", async () => {
    const cwd = workspace();
    const sessions = join(cwd, "sessions");
    const manager = SessionManager.create(cwd, sessions);
    manager.appendMessage({ role: "user", content: "request", timestamp: 0 });
    const failed = appendTool(manager, "failed", "read", "missing file", { path: "file.ts" }, true);
    const old = appendTool(manager, "old", "inspect", "source line", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const sibling = manager.appendMessage(assistantMessage("sibling reply"));
    manager.branch(old.resultId);
    appendTool(manager, "new", "inspect", "source line", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const grep = appendTool(manager, "grep", "grep", "file.ts\n1: source line");
    manager.appendLabelChange(failed.resultId, "bookmark");
    const beforeEdits = manager.getLeafId()!;
    const raw = structuredClone(manager.getEntries());
    const originalContext = manager.buildSessionProjection().messages;
    const file = manager.getSessionFile()!;
    const prefix = readFileSync(file);
    const snapshot = await startDeduplicator(manager);

    expect((await snapshot.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["failed", "new", "grep"]);
    expect(readFileSync(file)).toEqual(prefix);
    expect(manager.getEntries()).toEqual(raw);
    expect(manager.buildSessionProjection().messages).toEqual(originalContext);
    expect(manager.getLabel(failed.resultId)).toBe("bookmark");

    await settleOptimizer(manager);
    const optimizedLeaf = manager.getLeafId()!;
    const optimized = manager.buildSessionProjection().messages;

    expect(readFileSync(file).subarray(0, prefix.length)).toEqual(prefix);
    expect(manager.getEntries().slice(0, raw.length)).toEqual(raw);
    expect(optimized.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "new", "grep"]);
    expect((await snapshot.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep"]);

    const reopened = SessionManager.open(file, sessions, cwd);
    expect(reopened.buildSessionProjection().messages).toEqual(optimized);
    expect(reopened.getLabel(failed.resultId)).toBe("bookmark");
    for (const entry of raw) expect(reopened.getEntry(entry.id)).toEqual(entry);
    expect(await settleOptimizer(reopened)).toBeUndefined();
    const resumedBytes = readFileSync(file);
    const resumed = await startDeduplicator(reopened, "resume");
    expect((await resumed.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep"]);
    expect(readFileSync(file)).toEqual(resumedBytes);

    reopened.branch(beforeEdits);
    await resumed.pi.event("session_tree")({ type: "session_tree", oldLeafId: optimizedLeaf, newLeafId: beforeEdits }, resumed.ctx);
    expect(await resumed.request()).toEqual(originalContext);
    expect(reopened.buildSessionProjection().messages).toEqual(originalContext);
    reopened.branch(sibling);
    expect(reopened.buildSessionProjection().messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["failed", "old"]);
    reopened.branch(optimizedLeaf);
    expect(reopened.buildSessionProjection().messages).toEqual(optimized);
    expect(await resumed.request()).toEqual(optimized);

    const forkFile = reopened.createBranchedSession(optimizedLeaf)!;
    const fork = SessionManager.open(forkFile, sessions, cwd);
    expect(fork.buildSessionProjection().messages).toEqual(optimized);
    expect(fork.getEntry(grep.resultId)).toEqual(manager.getEntry(grep.resultId));
    expect(fork.getEntry(old.resultId)).toEqual(manager.getEntry(old.resultId));
    const forkBytes = readFileSync(forkFile);
    const forked = await startDeduplicator(fork, "fork");
    expect((await forked.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep"]);
    expect(readFileSync(forkFile)).toEqual(forkBytes);
    fork.branch(grep.resultId);
    await forked.pi.event("session_tree")({ type: "session_tree", oldLeafId: optimizedLeaf, newLeafId: grep.resultId }, forked.ctx);
    expect(await forked.request()).toEqual(originalContext);
    expect(fork.buildSessionProjection().messages).toEqual(originalContext);
    fork.branch(old.resultId);
    const branchStart = await startDeduplicator(fork, "fork");
    expect((await branchStart.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["failed", "old"]);
  });

  it("keeps canonical compaction boundaries and retained calls intact while hiding them in requests", async () => {
    const manager = SessionManager.inMemory(workspace());
    const hidden = appendTool(manager, "hidden", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const old = appendTool(manager, "old", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const compactId = manager.appendCompaction("previous summary", old.callId, 100);
    appendTool(manager, "new", "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    const raw = structuredClone(manager.getEntries());

    const canonical = structuredClone(manager.buildSessionProjection());
    const snapshot = await startDeduplicator(manager);
    const filtered = await snapshot.request();

    expect(await settleOptimizer(manager)).toBeUndefined();
    expect(filtered.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new"]);
    expect(manager.buildSessionProjection()).toEqual(canonical);
    expect(manager.getEntry(compactId)).toMatchObject({ firstKeptEntryId: old.callId, summary: "previous summary" });
    expect(manager.getEntries()).toEqual(raw);
    expect(manager.buildSessionProjection().entries.find((entry) => entry.sourceEntry.id === hidden.resultId)).toBeUndefined();
    expect(manager.buildSessionProjection().messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "new"]);
    expect(manager.buildSessionProjection().messages.some((message) => message.role === "compactionSummary")).toBe(true);
  });

  it("leaves native compaction canonical while persistent pruning still removes paired failures", async () => {
    const cwd = workspace();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in optimizer integration test"); }));
    onTestFinished(() => { vi.unstubAllGlobals(); });
    const manager = SessionManager.inMemory(cwd);
    manager.appendMessage({ role: "user", content: "inspect source", timestamp: 0 });
    appendTool(manager, "old", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    appendTool(manager, "new", "inspect", "first\nsecond", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
    appendTool(manager, "grep", "grep", "file.ts\n1: long raw grep source");
    appendTool(manager, "failed", "read", "missing file", { path: "file.ts" }, true);
    manager.appendMessage(assistantMessage("finished"));
    manager.appendMessage({ role: "user", content: "next task", timestamp: 0 });
    const settingsManager = SettingsManager.inMemory({ compaction: { keepRecentTokens: 0 } });
    const preparations: SessionBeforeCompactEvent["preparation"][] = [];
    const resourceLoader = new DefaultResourceLoader({
      cwd, agentDir: cwd, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [deduplicator, (pi) => {
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
    const snapshot = await startDeduplicator(manager);
    expect((await snapshot.request()).filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["new", "grep", "failed"]);
    await settleOptimizer(manager);
    await expect(session.compact()).rejects.toThrow("Compaction cancelled");

    expect(preparations).toHaveLength(2);
    const before = [...preparations[0]!.messagesToSummarize, ...preparations[0]!.turnPrefixMessages];
    const after = [...preparations[1]!.messagesToSummarize, ...preparations[1]!.turnPrefixMessages];
    expect(before.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "new", "grep", "failed"]);
    expect(after.filter((message) => message.role === "toolResult").map((message) => message.toolCallId)).toEqual(["old", "new", "grep"]);
    expect(after.filter((message) => message.role === "assistant").flatMap((message) => message.content.filter((block) => block.type === "toolCall").map((block) => block.id))).toEqual(["old", "new", "grep"]);
  });
});
