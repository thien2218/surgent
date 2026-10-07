import type { Model } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkSession } from "../../../src/subagent/sdk.js";
import { resolveRuntime } from "../../../src/subagent/storage.js";
import { getState, STATE_EVENT } from "../../../src/state.js";
import { assistantMessage } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { subagentSetup } from "../../helpers/subagent.js";
import { join } from "node:path";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, createAgentSession: vi.fn(), DefaultResourceLoader: vi.fn(class { reload = vi.fn(async () => {}); }) };
});
afterEach(() => { vi.clearAllMocks(); vi.mocked(createAgentSession).mockReset(); });

async function setup() {
  const fixture = await subagentSetup();
  const runtime = await resolveRuntime(fixture.cwd, "worker");
  const model: Model<"openai-responses"> = {
    id: "test-model", name: "Test model", api: "openai-responses", provider: "test-provider",
    baseUrl: "https://example.invalid", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
  };
  return { ...fixture, runtime, model };
}

async function bridgeSetup() {
  const fixture = await setup();
  await createSdkSession(fixture.request, fixture.runtime);
  const loader = vi.mocked(DefaultResourceLoader).mock.calls[0]![0]!;
  const bridge = loader.extensionFactories!.find((extension) => extension.name === "subsession-bridge");
  if (!bridge || typeof bridge === "function") throw new Error("Missing subsession bridge");
  const extension = recordExtension({ events: createEventBus() });
  await bridge.factory(extension.api);
  return { ...fixture, extension, loader };
}

describe("SDK session configuration", () => {
  it("uses parent model, thinking level and UI with an in-memory session", async () => {
    const fixture = await setup();
    fixture.request.ctx = { ...fixture.ctx, model: fixture.model, thinkingLevel: "low" };
    await createSdkSession(fixture.request, fixture.runtime);
    const options = vi.mocked(createAgentSession).mock.calls[0]![0]!;
    expect(options).toMatchObject({ cwd: fixture.cwd, model: fixture.request.ctx.model, thinkingLevel: "low" });
    expect(options.sessionManager!.getSessionFile()).toBeUndefined();
    expect(fixture.sessions[0]!.bindExtensions).toHaveBeenCalledWith({ mode: fixture.ctx.mode, uiContext: fixture.ui });
    expect(fixture.sessions[0]!.setActiveToolsByName).toHaveBeenCalledWith(["read", "bash"]);
  });

  it("applies profile model, thinking level, prompt and allowed tools", async () => {
    const fixture = await setup();
    fixture.runtime.meta.model = "openai/gpt-4o";
    fixture.runtime.meta.thinking_level = "high";
    fixture.runtime.meta.tools = ["read"];
    fixture.modelRegistry.find.mockReturnValue(fixture.model);
    await createSdkSession(fixture.request, fixture.runtime);
    expect(fixture.modelRegistry.find).toHaveBeenCalledWith("openai", "gpt-4o");
    expect(vi.mocked(createAgentSession).mock.calls[0]![0]).toMatchObject({ model: fixture.model, thinkingLevel: "high" });
    const loader = vi.mocked(DefaultResourceLoader).mock.calls[0]![0]!;
    expect(loader).toMatchObject({ cwd: fixture.cwd, noExtensions: true });
    expect(loader.systemPromptOverride!("parent prompt")).toBe(fixture.runtime.systemPrompt);
    expect(loader.extensionFactories!.map((extension) => extension.name)).toEqual(expect.arrayContaining([
      "subsession-bridge", "optimizer", "permission", "questionnaire", "redactor", "web-tools",
    ]));
    expect(fixture.sessions[0]!.setActiveToolsByName).toHaveBeenCalledWith(["read"]);
  });

  it("preserves an explicitly empty allowed tool list and binds without UI", async () => {
    const fixture = await setup();
    fixture.runtime.meta.tools = [];
    fixture.request.ctx = { ...fixture.ctx, hasUI: false };
    await createSdkSession(fixture.request, fixture.runtime);
    expect(fixture.sessions[0]!.setActiveToolsByName).toHaveBeenCalledWith([]);
    expect(fixture.sessions[0]!.bindExtensions).toHaveBeenCalledWith({ mode: fixture.ctx.mode, uiContext: undefined });
  });

  it("rejects unknown configured models before creating a session", async () => {
    const fixture = await setup();
    fixture.runtime.meta.model = "missing/model";
    await expect(createSdkSession(fixture.request, fixture.runtime)).rejects.toThrow('Unknown model "missing/model"');
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("disposes an SDK session when extension binding fails", async () => {
    const fixture = await setup();
    const original = vi.mocked(createAgentSession).getMockImplementation()!;
    vi.mocked(createAgentSession).mockImplementation(async (options) => {
      const result = await original(options);
      fixture.sessions[0]!.bindExtensions.mockRejectedValueOnce(new Error("bind failed"));
      return result;
    });
    await expect(createSdkSession(fixture.request, fixture.runtime)).rejects.toThrow("bind failed");
    expect(fixture.sessions[0]!.dispose).toHaveBeenCalledOnce();
    expect(fixture.sessions[0]!.setActiveToolsByName).not.toHaveBeenCalled();
  });

  it("creates persistent sessions linked to the parent transcript", async () => {
    const fixture = await setup();
    const parentPath = join(fixture.cwd, "parent.jsonl");
    fixture.request.temporary = false;
    fixture.request.ctx = { ...fixture.ctx, sessionManager: { ...fixture.ctx.sessionManager, getSessionFile: () => parentPath } };
    await createSdkSession(fixture.request, fixture.runtime);
    const manager = vi.mocked(createAgentSession).mock.calls[0]![0]!.sessionManager!;
    expect(manager.getSessionDir()).toBe(join(fixture.cwd, ".pi", "subsessions"));
    expect(manager.getHeader()?.parentSession).toBe(parentPath);
  });

  it("resumes the selected transcript without replacing its saved thinking level with parent defaults", async () => {
    const fixture = await setup();
    const manager = SessionManager.create(fixture.cwd, join(fixture.cwd, ".pi", "subsessions"));
    manager.appendMessage(assistantMessage("saved"));
    fixture.request.temporary = false;
    fixture.request.id = manager.getSessionId();
    await createSdkSession(fixture.request, fixture.runtime);
    const options = vi.mocked(createAgentSession).mock.calls[0]![0]!;
    expect(options.sessionManager!.getSessionId()).toBe(manager.getSessionId());
    expect(options.sessionManager!.getSessionFile()).toBe(manager.getSessionFile());
    expect(options.thinkingLevel).toBeUndefined();
  });

  it("rejects resume when the transcript is missing", async () => {
    const fixture = await setup();
    fixture.request.temporary = false;
    fixture.request.id = "missing";
    await expect(createSdkSession(fixture.request, fixture.runtime)).rejects.toThrow("Subsession file not found");
    expect(createAgentSession).not.toHaveBeenCalled();
  });
});

describe("subsession bridge", () => {
  it("exposes child profile and parent session state, including mode changes", async () => {
    const { extension, state, runtime, ctx } = await bridgeSetup();
    expect(() => extension.api.events.emit(STATE_EVENT, "not a callback")).not.toThrow();
    const childState = getState(extension.api);
    expect(childState.pid).toBe(ctx.sessionManager.getSessionId());
    expect(childState.getAgent()).toMatchObject({ name: "worker", meta: runtime.meta, body: runtime.systemPrompt });
    await childState.setMode("restricted");
    expect(state.getMode()).toBe("restricted");
    expect(childState.getMode()).toBe("restricted");
  });

  it.each(["shutdown", "dispose"])("unsubscribes state replies on %s", async (method) => {
    const { extension, ctx } = await bridgeSetup();
    if (method === "shutdown") await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    else getState(extension.api).dispose();
    expect(() => getState(extension.api)).toThrow("Session state is unavailable");
  });

  it.each(["read", "write", "edit", "grep", "find", "ls"])("requires explicit string paths for %s", async (toolName) => {
    const { extension, ctx } = await bridgeSetup();
    for (const path of [undefined, null, 7, {}, ["file"]]) {
      const event = { type: "tool_call" as const, toolName, toolCallId: "call", input: { path } };
      expect(await extension.event("tool_call")(event, ctx)).toEqual({ block: true, reason: "Explicit path required in subsession" });
    }
    expect(await extension.event("tool_call")({ type: "tool_call", toolName, toolCallId: "call", input: { path: "." } }, ctx)).toBeUndefined();
  });

  it("does not require paths for non-path tools", async () => {
    const { extension, ctx } = await bridgeSetup();
    expect(await extension.event("tool_call")({ type: "tool_call", toolName: "bash", toolCallId: "call", input: { command: "pwd" } }, ctx)).toBeUndefined();
  });
});
