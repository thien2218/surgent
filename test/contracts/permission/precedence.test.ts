import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import permissionExtension from "../../../src/permission/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import type { AgentMeta } from "../../../src/agent/types.js";

const agentState = vi.hoisted(() => ({ meta: { description: "test" } as AgentMeta }));

vi.mock("../../../src/agent/storage.js", () => ({
  loadMainAgent: vi.fn(async () => ({
    name: "main",
    body: "agent body",
    meta: agentState.meta,
    filePath: "main.md",
  })),
}));

type FakeContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    setStatus: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    custom: ReturnType<typeof vi.fn>;
    theme: { fg: ReturnType<typeof vi.fn> };
  };
  sessionManager: { getSessionId: () => string };
};

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-permission-contract-");
  agentState.meta = { description: "test" };
});

afterEach(async () => {
  await workspace.restore();
  vi.restoreAllMocks();
});

describe("permission lifecycle and command contracts", () => {
  it("prepends the loaded agent instructions without losing the Pi system prompt", async () => {
    const pi = fakePi();
    const ctx = fakeContext(false);
    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    try {
      expect(pi.events.before_agent_start).toBeTypeOf("function");
      const result = await pi.events.before_agent_start!({ systemPrompt: "Pi instructions\nPreserve this line." }, ctx);

      expect(result).toEqual({ systemPrompt: "agent body\n\nPi instructions\nPreserve this line." });
    } finally {
      await pi.events.session_shutdown?.({}, ctx);
    }
  });

  it("rejects headless /permissions without opening UI or reading broken storage", async () => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), "not-json");
    const pi = fakePi();
    const ctx = fakeContext(false);
    permissionExtension(pi.api);

    expect(pi.commands.permissions).toBeDefined();
    await expect(pi.commands.permissions!.handler("", ctx)).resolves.toBeUndefined();

    expect(ctx.ui.notify).toHaveBeenCalledWith("The /permissions command requires an interactive UI.", "error");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });
});

describe("permission precedence contract", () => {
  it("lets a winning allow proceed without prompting", async () => {
    await writeRules({ web: { "https://example.com": true } });
    const pi = fakePi();
    const ctx = fakeContext(false);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const result = await pi.events.tool_call?.({ toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.events.session_shutdown?.({}, ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("blocks a winning deny", async () => {
    await writeRules({ web: { "https://example.com": false } });
    const pi = fakePi();
    const ctx = fakeContext(false);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const result = await pi.events.tool_call?.({ toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.events.session_shutdown?.({}, ctx);

    expect(result).toEqual({ block: true, reason: "Access to this resource is denied" });
  });

  it("asks through UI for unresolved interactive requests", async () => {
    const pi = fakePi();
    const ctx = fakeContext(true);
    ctx.ui.custom.mockResolvedValue({ allowed: true });

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const result = await pi.events.tool_call?.({ toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.events.session_shutdown?.({}, ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it("blocks .piignore paths despite explicit permission allow", async () => {
    await writeRules({ project: { file: { "secret.txt": "read" } } }, workspace.cwd);
    await writeFile(join(workspace.cwd, ".piignore"), "secret.txt\n");
    const pi = fakePi();
    const ctx = fakeContext(false);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const result = await pi.events.tool_call?.({ toolName: "read", input: { path: join(workspace.cwd, "secret.txt") } }, ctx);
    await pi.events.session_shutdown?.({}, ctx);

    expect(result).toEqual({ block: true, reason: "Path blocked by .piignore rule \"secret.txt\"" });
  });

  it.each([
    { toolName: "write", input: { path: "private/file.ts", content: "test" } },
    { toolName: "edit", input: { path: "private/file.ts", edits: [] } },
    { toolName: "grep", input: { path: "private", pattern: "test" } },
    { toolName: "grep", input: { path: ".", glob: "private/**/*.ts", pattern: "test" } },
  ])("guards .piignore inputs for $toolName: $input", async (event) => {
    await writeFile(join(workspace.cwd, ".piignore"), "private/\n");
    await writeRules({ project: { file: { "*": "write" } } }, workspace.cwd);
    const pi = fakePi();
    const ctx = fakeContext(true);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    try {
      const result = await pi.events.tool_call?.(event, ctx);

      expect(result).toEqual({ block: true, reason: 'Path blocked by .piignore rule "private/"' });
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    } finally {
      await pi.events.session_shutdown?.({}, ctx);
    }
  });

  it.each([
    { decision: undefined, reason: "Permission request was cancelled" },
    { decision: { allowed: false }, reason: "User rejected this tool call" },
  ])("blocks execution when prompt returns $decision", async ({ decision, reason }) => {
    const pi = fakePi();
    const ctx = fakeContext(true);
    ctx.ui.custom.mockResolvedValue(decision);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    try {
      const result = await pi.events.tool_call?.({ toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);

      expect(result).toEqual({ block: true, reason: expect.stringContaining(reason) });
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    } finally {
      await pi.events.session_shutdown?.({}, ctx);
    }
  });

  it.each([
    { toolName: "write", input: null },
    { toolName: "bash", input: { command: 42 } },
    { toolName: "call_mcp_tool", input: { server: "docs" } },
  ])("fails closed for malformed $toolName input", async (event) => {
    const pi = fakePi();
    const ctx = fakeContext(true);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    try {
      const result = await pi.events.tool_call?.(event, ctx);

      expect(result).toEqual({ block: true, reason: "Permission check failed" });
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    } finally {
      await pi.events.session_shutdown?.({}, ctx);
    }
  });

  it("fails closed on malformed permission or .piignore state and removes resize listener", async () => {
    const listenersBefore = process.stdout.listenerCount("resize");
    await writeFile(join(workspace.home, ".pi", "agent", "permissions.json"), "not-json");
    const pi = fakePi();
    const ctx = fakeContext(false);

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const malformedPermission = await pi.events.tool_call?.({ toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await writeFile(join(workspace.cwd, ".piignore"), "!\n");
    const malformedPiIgnore = await pi.events.tool_call?.({ toolName: "read", input: { path: join(workspace.cwd, "file.ts") } }, ctx);
    await pi.events.session_shutdown?.({}, ctx);

    expect(malformedPermission).toEqual({ block: true, reason: "Permission check failed" });
    expect(malformedPiIgnore).toEqual({ block: true, reason: "Permission check failed" });
    expect(process.stdout.listenerCount("resize")).toBe(listenersBefore);
  });
});

function fakePi() {
  const events: Record<string, ((event: unknown, ctx: FakeContext) => unknown) | undefined> = {};
  const commands: Record<string, { handler: (args: string, ctx: FakeContext) => unknown } | undefined> = {};
  return {
    events,
    commands,
    api: {
      registerShortcut: vi.fn(),
      registerCommand: vi.fn((name, command) => {
        commands[name] = command;
      }),
      on: vi.fn((name, handler) => {
        events[name] = handler as (event: unknown, ctx: FakeContext) => unknown;
      }),
      sendUserMessage: vi.fn(),
    } as never,
  };
}

function fakeContext(hasUI: boolean): FakeContext {
  return {
    cwd: workspace.cwd,
    hasUI,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      custom: vi.fn(),
      theme: { fg: vi.fn((_name: string, text: string) => text) },
    },
    sessionManager: { getSessionId: () => "session-1" },
  };
}
