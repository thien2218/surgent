import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { openSubsession } from "../../../src/subagent/subsession.js";
import { findSubsession } from "../../../src/subagent/storage.js";
import { assistantMessage } from "../../helpers/commands.js";
import { subagentSetup } from "../../helpers/subagent.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, createAgentSession: vi.fn(), DefaultResourceLoader: vi.fn(class { reload = vi.fn(async () => {}); }) };
});
afterEach(() => { vi.clearAllMocks(); vi.mocked(createAgentSession).mockReset(); });

async function setup() {
  const fixture = await subagentSetup();
  const child = await openSubsession(fixture.request);
  onTestFinished(() => child.dispose());
  return { ...fixture, child, session: fixture.sessions[0]! };
}

const quickReport = "## Answer\nAnswer\n## Evidence\nfile.ts:1\n## Gaps\nNone";
const validPlan = "# Plan: Work\n## Objective\nGoal\n## Out of scope\nNone\n## Steps\nWork\n## Risks & Mitigations\nNone\n## Handoff Packet\nReady";

describe("subsession turns", () => {
  it("publishes progress, final text, tool counts, and context usage", async () => {
    const { child, session, turns, snapshots } = await setup();
    session.getContextUsage.mockReturnValue({ tokens: 25, contextWindow: 100, percent: 25 });
    turns.push((current) => {
      const message = assistantMessage("first");
      message.content.push(
        { type: "toolCall", id: "read-one", name: "read", arguments: { path: "one" } },
        { type: "toolCall", id: "read-two", name: "read", arguments: { path: "two" } },
        { type: "toolCall", id: "find", name: "find", arguments: { path: ".", pattern: "*.ts" } },
        { type: "text", text: "final" },
      );
      current.emit({ type: "message_end", message });
    });
    await child.exec("Task");
    expect(session.prompt).toHaveBeenCalledWith("Task");
    expect(child.result).toMatchObject({ id: session.sessionId, status: "done", output: "final", toolCounts: { read: 2, find: 1 }, usage: { toolCalls: 3 } });
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual(["running", "running", "done"]);
    expect(snapshots[0]?.toolsUsed).toEqual([]);
    expect(snapshots.at(-1)).toMatchObject({ contextUsage: { percent: 25 }, toolsUsed: ['read({"path":"one"})', 'read({"path":"two"})', 'find({"path":".","pattern":"*.ts"})'] });
    expect(session.listenerCount()).toBe(0);
  });

  it("accumulates assistant tokens and all billed costs without counting nested tokens twice", async () => {
    const { child, turns } = await setup();
    const message = assistantMessage("answer");
    message.usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 19,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
    turns.push((session) => {
      session.emit({ type: "message_end", message });
      session.emit({ type: "message_end", message: {
        role: "toolResult", toolCallId: "nested", toolName: "subagent", content: [], isError: false, timestamp: 0, usage: message.usage,
      } });
      session.emit({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: {
        summary: "summary", firstKeptEntryId: "entry", tokensBefore: 19, usage: message.usage,
      } });
      session.emit({ type: "compaction_end", reason: "manual", aborted: true, willRetry: false, result: undefined });
      session.emit({ type: "message_end", message: { role: "user", content: "ignored", timestamp: 0 } });
    });
    await child.exec("Task");
    expect(child.result.usage).toEqual({ input: 10, output: 2, toolCalls: 0,
      cost: { input: 3, output: 6, cacheRead: 9, cacheWrite: 12, total: 30 } });
  });

  it("keeps cumulative usage across turns but resets per-turn tool history", async () => {
    const { child, turns, snapshots } = await setup();
    turns.push((session) => {
      const message = assistantMessage("one");
      message.usage.input = 5;
      message.content.push({ type: "toolCall", id: "call", name: "read", arguments: { path: "file" } });
      session.emit({ type: "message_end", message });
    }, (session) => {
      const message = assistantMessage("two");
      message.usage.input = 7;
      session.emit({ type: "message_end", message });
    });
    await child.exec("First");
    await child.exec("Second");
    expect(child.result).toMatchObject({ output: "two", usage: { input: 12, toolCalls: 1 }, toolCounts: {} });
    expect(snapshots.at(-1)?.toolsUsed).toEqual([]);
  });

  it("uses session history when no text is emitted during a turn", async () => {
    const { child, session, turns } = await setup();
    session.messages.push(assistantMessage("history answer"));
    turns.push(() => {});
    await child.exec("Task");
    expect(child.result.output).toBe("history answer");
  });

  it.each([new Error("provider failed"), "provider failed"])("reports thrown prompt failure %s and unsubscribes", async (failure) => {
    const { child, session, turns, snapshots } = await setup();
    turns.push(() => { throw failure; });
    await child.exec("Task");
    expect(child.result).toMatchObject({ status: "error", output: "provider failed" });
    expect(snapshots.at(-1)?.status).toBe("error");
    expect(session.listenerCount()).toBe(0);
  });

  it.each(["provider error", undefined])("reports assistant error with message %s", async (errorMessage) => {
    const { child, turns } = await setup();
    turns.push((session) => {
      session.emit({ type: "message_end", message: { ...assistantMessage("partial"), stopReason: "error", errorMessage } });
    });
    await child.exec("Task");
    expect(child.result).toMatchObject({ status: "error", output: errorMessage ?? "Subsession failed" });
  });

  it("lets abort status take precedence over assistant errors", async () => {
    const { child, turns } = await setup();
    turns.push((session) => {
      session.emit({ type: "message_end", message: { ...assistantMessage("error text"), stopReason: "error" } });
      session.emit({ type: "message_end", message: { ...assistantMessage("partial answer"), stopReason: "aborted" } });
    });
    await child.exec("Task");
    expect(child.result).toMatchObject({ status: "aborted", output: "partial answer" });
  });

  it("does not prompt when execution signal is already aborted", async () => {
    const { child, session } = await setup();
    const controller = new AbortController();
    controller.abort();
    await child.exec("Task", controller.signal);
    expect(session.prompt).not.toHaveBeenCalled();
    expect(session.abort).toHaveBeenCalledOnce();
    expect(child.result.status).toBe("aborted");
    expect(session.listenerCount()).toBe(0);
  });

  it("propagates active cancellation and releases listeners even when SDK abort rejects", async () => {
    const { child, session, turns } = await setup();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    onTestFinished(() => finished.resolve());
    turns.push(async () => { started.resolve(); await finished.promise; });
    session.abort.mockImplementation(async () => { finished.resolve(); throw new Error("abort failed"); });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const execution = child.exec("Task", controller.signal);
    await started.promise;
    controller.abort();
    await execution;
    expect(child.result.status).toBe("aborted");
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.listenerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    remove.mockRestore();
  });
});

describe("built-in output repair", () => {
  it.each([["planner", validPlan, "Task"], ["scout", quickReport, "Depth: quick\nTask"]])(
    "accepts valid %s output without another turn", async (agent, output, input) => {
      const fixture = await subagentSetup();
      fixture.request.agent = agent;
      fixture.turns.push((session) => session.emit({ type: "message_end", message: assistantMessage(output) }));
      const child = await openSubsession(fixture.request);
      onTestFinished(() => child.dispose());
      await child.exec(input);
      expect(child.result).toMatchObject({ status: "done", output });
      expect(fixture.sessions[0]!.prompt).toHaveBeenCalledOnce();
    },
  );

  it("repairs invalid scout output once using original requested depth and counts both attempts", async () => {
    const fixture = await subagentSetup();
    fixture.request.agent = "scout";
    fixture.turns.push(...["invalid", quickReport].map((output) => (session: typeof fixture.sessions[number]) => {
      const message = assistantMessage(output);
      message.usage.input = 5;
      session.emit({ type: "message_end", message });
    }));
    const child = await openSubsession(fixture.request);
    onTestFinished(() => child.dispose());
    await child.exec("Depth: quick\nTask");
    expect(child.result).toMatchObject({ status: "done", output: quickReport, usage: { input: 10 } });
    expect(fixture.sessions[0]!.prompt).toHaveBeenNthCalledWith(2, expect.stringContaining("Output failed validation:"));
  });

  it("fails after two invalid replies without an unbounded retry", async () => {
    const fixture = await subagentSetup();
    fixture.request.agent = "planner";
    const child = await openSubsession(fixture.request);
    onTestFinished(() => child.dispose());
    await child.exec("Task");
    expect(child.result.status).toBe("error");
    expect(child.result.output).toContain("Output validation failed:");
    expect(fixture.sessions[0]!.prompt).toHaveBeenCalledTimes(2);
  });

  it.each(["error", "aborted"] as const)("preserves %s from corrective turn instead of reporting a validation failure", async (stopReason) => {
    const fixture = await subagentSetup();
    fixture.request.agent = "planner";
    fixture.turns.push(
      (session) => session.emit({ type: "message_end", message: assistantMessage("invalid") }),
      (session) => session.emit({ type: "message_end", message: { ...assistantMessage("partial"), stopReason, errorMessage: "provider failed" } }),
    );
    const child = await openSubsession(fixture.request);
    onTestFinished(() => child.dispose());
    await child.exec("Task");
    expect(child.result).toMatchObject({ status: stopReason, output: stopReason === "error" ? "provider failed" : "partial" });
    expect(fixture.sessions[0]!.prompt).toHaveBeenCalledTimes(2);
  });
});

describe("persistent session lifecycle", () => {
  it("persists and resumes output, title, profile and cumulative usage under the same parent", async () => {
    const fixture = await subagentSetup();
    fixture.request.temporary = false;
    fixture.turns.push((session) => {
      const message = assistantMessage("# Plan: Saved task");
      message.usage.input = 9;
      session.emit({ type: "message_end", message });
    });
    const child = await openSubsession(fixture.request);
    onTestFinished(() => child.dispose());
    await child.exec("Task");
    expect(await findSubsession(fixture.cwd, child.result.id, "parent-session")).toMatchObject({ title: "Saved task", usage: { input: 9 } });
    const resumed = await openSubsession({ ...fixture.request, id: child.result.id, agent: "missing-profile" });
    onTestFinished(() => resumed.dispose());
    expect(resumed.runtime.agent).toBe("worker");
    expect(resumed.title).toBe("Saved task");
    expect(resumed.result).toMatchObject({ id: child.result.id, output: "# Plan: Saved task", usage: { input: 9 } });
  });

  it("keeps temporary session output off disk", async () => {
    const { child, cwd } = await setup();
    await child.exec("Task");
    await expect(readFile(join(cwd, ".pi", "subsessions.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await findSubsession(cwd, child.result.id)).toBeNull();
  });

  it("rejects foreign-parent and unknown session IDs without creating SDK sessions", async () => {
    const fixture = await subagentSetup();
    fixture.request.temporary = false;
    const child = await openSubsession(fixture.request);
    onTestFinished(() => child.dispose());
    await child.exec("Task");
    const foreign = await openSubsession({ ...fixture.request, id: child.result.id,
      ctx: { ...fixture.ctx, sessionManager: { ...fixture.ctx.sessionManager, getSessionId: () => "other-parent" } },
    });
    const missing = await openSubsession({ ...fixture.request, id: "missing" });
    expect(foreign.result).toMatchObject({ status: "error", output: expect.stringContaining("Subsession not found") });
    expect(missing.result.status).toBe("error");
    expect(createAgentSession).toHaveBeenCalledOnce();
    await missing.exec("Task");
    expect(missing.result).toMatchObject({ status: "error", output: "Subsession unavailable" });
    await expect(missing.dispose()).resolves.toBeUndefined();
  });

  it.each([new Error("SDK unavailable"), "SDK unavailable"])("turns SDK setup failure %s into an unavailable subsession", async (failure) => {
    const fixture = await subagentSetup();
    vi.mocked(createAgentSession).mockRejectedValueOnce(failure);
    const child = await openSubsession(fixture.request);
    expect(child.result).toMatchObject({ status: "error", output: "SDK unavailable", usage: { input: 0 } });
    await expect(child.dispose()).resolves.toBeUndefined();
  });

  it("rejects an unknown runtime before opening an SDK session", async () => {
    const fixture = await subagentSetup();
    await expect(openSubsession({ ...fixture.request, agent: "missing-profile" })).rejects.toThrow();
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("disposes session when saving completed output fails", async () => {
    const fixture = await subagentSetup();
    fixture.request.temporary = false;
    const child = await openSubsession(fixture.request);
    await writeFile(join(fixture.cwd, ".pi", "subsessions.json"), "broken JSON");
    await expect(child.exec("Task")).rejects.toThrow();
    expect(fixture.sessions[0]!.dispose).toHaveBeenCalledOnce();
    expect(await readFile(join(fixture.cwd, ".pi", "subsessions.json"), "utf8")).toBe("broken JSON");
  });

  it("emits shutdown before disposal and disposes even when shutdown fails", async () => {
    const fixture = await subagentSetup();
    const child = await openSubsession(fixture.request);
    const session = fixture.sessions[0]!;
    session.extensionRunner.emit.mockImplementation(async () => {
      expect(session.dispose).not.toHaveBeenCalled();
      throw new Error("shutdown failed");
    });
    await expect(child.dispose()).rejects.toThrow("shutdown failed");
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
    expect(session.dispose).toHaveBeenCalledOnce();
  });
});
