import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type Component } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import subagent from "../../../src/subagent/index.js";
import { createErrorResult } from "../../../src/subagent/helpers.js";
import { assistantMessage } from "../../helpers/commands.js";
import { subagentSetup } from "../../helpers/subagent.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, createAgentSession: vi.fn(), DefaultResourceLoader: vi.fn(class { reload = vi.fn(async () => {}); }) };
});
beforeAll(() => { initTheme("dark", false); });
afterEach(() => { vi.clearAllMocks(); vi.mocked(createAgentSession).mockReset(); });

async function setup() {
  const fixture = await subagentSetup();
  subagent(fixture.extension.api);
  const tool = fixture.extension.tool("subagent");
  const run = (id = "call", signal?: AbortSignal, onUpdate = vi.fn()) =>
    tool.execute(id, { agent: "worker", task: "Bounded task", context: "Relevant findings" }, signal, onUpdate, fixture.ctx);
  const report = (id = "call", toolName = "subagent") => fixture.extension.event("tool_result")({
    type: "tool_result", toolName, toolCallId: id, input: {}, content: [], details: undefined, isError: false,
  }, fixture.ctx);
  return { ...fixture, tool, run, report };
}

function text(component: Component) {
  return component.render(100).map(stripTerminalSequences).join("\n");
}

describe("subagent tool contract", () => {
  it("registers delegation parameters and model-facing guidance", async () => {
    const { tool } = await setup();
    expect(tool.parameters).toMatchObject({ type: "object", required: ["agent", "task", "context"], properties: {
      agent: { type: "string" }, task: { type: "string" }, context: { type: "string" },
    } });
    expect(tool.description).toContain("separate session");
    expect(tool.promptSnippet).toContain("configured agents");
  });

  it("returns child output and progress, runs supplied task, and disposes without persisting", async () => {
    const { run, sessions, cwd } = await setup();
    const update = vi.fn();
    const result = await run("call", undefined, update);
    expect(result).toMatchObject({ content: [{ type: "text", text: "Complete" }], details: { status: "done", usage: { input: 0 } } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ content: [], details: expect.objectContaining({ id: sessions[0]!.sessionId }) }));
    expect(sessions[0]!.prompt).toHaveBeenCalledWith("Task:\nBounded task\n\nContext:\nRelevant findings");
    expect(sessions[0]!.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
    expect(sessions[0]!.dispose).toHaveBeenCalledOnce();
    await expect(readFile(join(cwd, ".pi", "subsessions.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("works without an update callback", async () => {
    const { tool, ctx } = await setup();
    const result = await tool.execute("call", { agent: "worker", task: "Task", context: "" }, undefined, undefined, ctx);
    expect(result.content).toEqual([{ type: "text", text: "Complete" }]);
  });

  it("surfaces startup failure without prompting", async () => {
    const { run, sessions } = await setup();
    vi.mocked(createAgentSession).mockRejectedValueOnce(new Error("startup failed"));
    await expect(run()).rejects.toThrow("startup failed");
    expect(sessions).toEqual([]);
  });

  it("uses a fallback error when startup provides no message", async () => {
    const { run } = await setup();
    vi.mocked(createAgentSession).mockRejectedValueOnce(new Error(""));
    await expect(run()).rejects.toThrow("Subsession failed");
  });

  it("reports execution failure and still disposes", async () => {
    const { run, sessions, turns } = await setup();
    turns.push(() => { throw new Error("provider failed"); });
    await expect(run()).rejects.toThrow("provider failed");
    expect(sessions[0]!.dispose).toHaveBeenCalledOnce();
    expect(sessions[0]!.listenerCount()).toBe(0);
  });

  it("forwards cancellation and returns aborted details rather than done", async () => {
    const { run, sessions } = await setup();
    const controller = new AbortController();
    controller.abort();
    const result = await run("call", controller.signal);
    expect(result.details).toMatchObject({ status: "aborted" });
    expect(sessions[0]!.prompt).not.toHaveBeenCalled();
    expect(sessions[0]!.abort).toHaveBeenCalledOnce();
    expect(sessions[0]!.dispose).toHaveBeenCalledOnce();
  });
});

describe("delegated usage reporting", () => {
  it.each(["stop", "error"] as const)("attaches cost once after %s without adding child tokens to parent tokens", async (stopReason) => {
    const { run, report, turns } = await setup();
    const message = assistantMessage("answer");
    message.stopReason = stopReason;
    message.errorMessage = "provider failed";
    message.usage = { input: 100, output: 50, cacheRead: 20, cacheWrite: 10, totalTokens: 180,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
    turns.push((session) => session.emit({ type: "message_end", message }));
    if (stopReason === "error") await expect(run()).rejects.toThrow("provider failed");
    else await run();
    expect(await report("call", "read")).toBeUndefined();
    expect(await report("unknown")).toBeUndefined();
    expect(await report()).toEqual({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: message.usage.cost } });
    expect(await report()).toBeUndefined();
  });

  it("keeps costs separate for overlapping delegations", async () => {
    const { run, report, turns } = await setup();
    const firstStarted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    turns.push(async (session) => {
      firstStarted.resolve();
      await release.promise;
      const message = assistantMessage("first");
      message.usage.cost.total = 1;
      session.emit({ type: "message_end", message });
    });
    const first = run("first");
    await firstStarted.promise;
    try {
      turns.push((session) => {
        const message = assistantMessage("second");
        message.usage.cost.total = 2;
        session.emit({ type: "message_end", message });
      });
      await run("second");
    } finally {
      release.resolve();
      await first;
    }
    expect(await report("second")).toMatchObject({ usage: { cost: { total: 2 } } });
    expect(await report("first")).toMatchObject({ usage: { cost: { total: 1 } } });
  });

  it("drops unreported costs at parent shutdown", async () => {
    const { run, report, extension, ctx } = await setup();
    await run();
    await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    expect(await report()).toBeUndefined();
  });
});

describe("subagent rendering", () => {
  it("renders task, starting state and progress from public tool results", async () => {
    const { tool, ui } = await setup();
    const args = { agent: "worker", task: "Inspect files", context: "" };
    const context = { args } as Parameters<NonNullable<typeof tool.renderResult>>[3];
    expect(text(tool.renderCall!(args, ui.theme, context))).toContain('subagent worker "Inspect files"');
    expect(text(tool.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: true }, ui.theme, context)))
      .toContain("Subagent worker: starting");
    const details = { id: "child", status: "running", toolsUsed: ['read({"path":"file.ts"})'], usage: createErrorResult("").usage };
    const rendered = text(tool.renderResult!({ content: [], details }, { expanded: false, isPartial: true }, ui.theme, context));
    expect(rendered).toContain("worker: running");
    expect(rendered).toContain("tools_used=0");
    expect(rendered).toContain('read({"path":"file.ts"})');
  });

  it("sizes the task preview to render width without shortening the delegated task or context", async () => {
    const { tool, ui, ctx, sessions } = await setup();
    const args = { agent: "worker", task: `${"Inspect files\n".repeat(60)}Task end`, context: "Prior findings\nKeep all context" };
    const context = { args } as Parameters<NonNullable<typeof tool.renderCall>>[2];
    const component = tool.renderCall!(args, ui.theme, context);

    for (const width of [40, 80]) {
      const lines = component.render(width).map(stripTerminalSequences);
      expect(lines.every((line) => line.length <= width)).toBe(true);
      // Ignore terminal wrapping and padding, not preview content.
      expect(lines.join("").replace(/\s/g, "")).toBe(
        `subagent worker "${args.task.slice(0, width * 4 - 50)}..."`.replace(/\s/g, ""),
      );
    }

    await tool.execute("call", args, undefined, undefined, ctx);

    expect(sessions[0]!.prompt).toHaveBeenCalledWith(`Task:\n${args.task}\n\nContext:\n${args.context}`);
  });

  it("truncates collapsed output while expanded output shows every line", async () => {
    const { tool, ui } = await setup();
    const result = { content: [{ type: "text" as const, text: Array.from({ length: 15 }, (_, index) => `Line ${index + 1}`).join("\n") }], details: undefined };
    const context = { args: { agent: "worker", task: "Task", context: "" } } as Parameters<NonNullable<typeof tool.renderResult>>[3];
    const collapsed = text(tool.renderResult!(result, { expanded: false, isPartial: false }, ui.theme, context));
    expect(collapsed).toContain("more lines");
    expect(collapsed).not.toMatch(/Line 1\s/);
    const expanded = text(tool.renderResult!(result, { expanded: true, isPartial: false }, ui.theme, context));
    expect(expanded).toMatch(/Line 1\s/);
    expect(expanded).toContain("Line 15");
    expect(text(tool.renderResult!({ content: [], details: undefined }, { expanded: true, isPartial: false }, ui.theme, context)).trim()).toBe("");
    expect(text(tool.renderResult!({ content: [{ type: "image", mimeType: "image/png", data: "" }], details: undefined },
      { expanded: true, isPartial: false }, ui.theme, context)).trim()).toBe("");
  });
});
