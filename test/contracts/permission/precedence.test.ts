import { mkdir, symlink, writeFile } from "node:fs/promises";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePermissionContext, makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { recordExtension } from "../../helpers/extension.js";
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
  it("replaces the resize listener on session restart and removes it on repeated shutdown", async () => {
    const listeners = process.stdout.listenerCount("resize");
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);
    permissionExtension(pi.api);
    try {
      await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
      expect(process.stdout.listenerCount("resize")).toBe(listeners + 1);
      await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
      expect(process.stdout.listenerCount("resize")).toBe(listeners + 1);
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
      expect(process.stdout.listenerCount("resize")).toBe(listeners);
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("prepends the loaded agent instructions without losing the Pi system prompt", async () => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);
    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      expect(pi.event("before_agent_start")).toBeTypeOf("function");
      const result = await pi.event("before_agent_start")({ type: "before_agent_start", prompt: "test", systemPromptOptions: { cwd: workspace.cwd, selectedTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [], appendSystemPrompt: "", sections: {}, contextFiles: [], skills: [] }, systemPrompt: "Pi instructions\nPreserve this line." }, ctx);

      expect(result).toEqual({ systemPrompt: "agent body\n\nPi instructions\nPreserve this line." });
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("rejects headless /permissions without opening UI or reading broken storage", async () => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), "not-json");
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);
    permissionExtension(pi.api);

    expect(pi.command("permissions")).toBeDefined();
    await expect(pi.command("permissions").handler("", ctx)).resolves.toBeUndefined();

    expect(ctx.ui.notify).toHaveBeenCalledWith("The /permissions command requires an interactive UI.", "error");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });
});

describe("permission precedence contract", () => {
  it.each([
    { alias: "alias.ts", target: "src/target.ts", blocked: false },
    { alias: "src/alias.ts", target: "private/target.ts", blocked: true },
  ])("applies agent file allowlists to $target, not $alias", async ({ alias, target, blocked }) => {
    await mkdir(join(workspace.cwd, "src"));
    await mkdir(join(workspace.cwd, "private"));
    await writeFile(join(workspace.cwd, target), "test");
    await symlink(join(workspace.cwd, target), join(workspace.cwd, alias));
    agentState.meta = { description: "test", "files.read": ["src/**"] };
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);
    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "read", input: { path: alias } }, ctx);

      if (blocked) {
        expect(result).toEqual({ block: true, reason: "Access to this resource is beyond allowed scope" });
      } else {
        expect(result).toBeUndefined();
      }
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });


  it.each([true, false])("routes amended prompt decisions without losing user instructions: allowed=%s", async (allowed) => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue({ allowed, amended: "Use the public endpoint instead" });
    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);

      if (allowed) {
        expect(result).toBeUndefined();
        expect(pi.api.sendUserMessage).toHaveBeenCalledWith(
          "Use the public endpoint instead", { deliverAs: "steer" },
        );
      } else {
        expect(result).toEqual({ block: true, reason: expect.stringContaining("User input: Use the public endpoint instead") });
        expect(pi.api.sendUserMessage).not.toHaveBeenCalled();
      }
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("reports failed rule persistence while respecting the one-time approval", async () => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue({ allowed: true, error: true });
    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);

      expect(result).toBeUndefined();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Failed to save permission rules, use `/permissions` to set them manually", "error",
      );
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("fails closed when the permission UI throws", async () => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockRejectedValue(new Error("UI unavailable"));
    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);

      expect(result).toEqual({ block: true, reason: "Permission check failed" });
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("lets a winning allow proceed without prompting", async () => {
    await writeRules({ web: { "https://example.com": true } });
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("blocks a winning deny", async () => {
    await writeRules({ web: { "https://example.com": false } });
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(result).toEqual({ block: true, reason: "Access to this resource is denied" });
  });

  it("asks through UI for unresolved interactive requests", async () => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue({ allowed: true });

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it("blocks .piignore paths despite explicit permission allow", async () => {
    await writeRules({ project: { file: { "secret.txt": "read" } } }, workspace.cwd);
    await writeFile(join(workspace.cwd, ".piignore"), "secret.txt\n");
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "read", input: { path: join(workspace.cwd, "secret.txt") } }, ctx);
    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

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
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ ...event, type: "tool_call", toolCallId: "call-1" }, ctx);

      expect(result).toEqual({ block: true, reason: 'Path blocked by .piignore rule "private/"' });
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it.each([
    { decision: undefined, reason: "Permission request was cancelled" },
    { decision: { allowed: false }, reason: "User rejected this tool call" },
  ])("blocks execution when prompt returns $decision", async ({ decision, reason }) => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue(decision);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);

      expect(result).toEqual({ block: true, reason: expect.stringContaining(reason) });
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it.each([
    { toolName: "write", input: null },
    { toolName: "bash", input: { command: 42 } },
    { toolName: "call_mcp_tool", input: { server: "docs" } },
  ])("fails closed for malformed $toolName input", async (event) => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, true);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    try {
      const result = await pi.event("tool_call")({ ...event, type: "tool_call", toolCallId: "call-1" } as ToolCallEvent, ctx);

      expect(result).toEqual({ block: true, reason: "Permission check failed" });
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    } finally {
      await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  });

  it("fails closed on malformed permission or .piignore state and removes resize listener", async () => {
    const listenersBefore = process.stdout.listenerCount("resize");
    await writeFile(join(workspace.home, ".pi", "agent", "permissions.json"), "not-json");
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd, false);

    permissionExtension(pi.api);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const malformedPermission = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "web_fetch", input: { url: "https://example.com" } }, ctx);
    await writeFile(join(workspace.cwd, ".piignore"), "!\n");
    const malformedPiIgnore = await pi.event("tool_call")({ type: "tool_call", toolCallId: "call-1", toolName: "read", input: { path: join(workspace.cwd, "file.ts") } }, ctx);
    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(malformedPermission).toEqual({ block: true, reason: "Permission check failed" });
    expect(malformedPiIgnore).toEqual({ block: true, reason: "Permission check failed" });
    expect(process.stdout.listenerCount("resize")).toBe(listenersBefore);
  });
});
