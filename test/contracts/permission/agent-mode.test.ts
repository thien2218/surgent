import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import permissionExtension from "../../../src/permission/index.js";
import { readAgentMode } from "../../../src/permission/storage.js";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

let workspace: Workspace;

beforeEach(async () => {
  vi.mocked(writeFile).mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).writeFile);
  workspace = await createWorkspace({ prefix: "surgent-mode-contract-" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("permission extension shared mode contract", () => {
  it("applies the stored mode supplied by session state to tool calls", async () => {
    await writeFile(join(workspace.home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "restricted" } }));
    const pi = makePermissionSession({ description: "test" }, await readAgentMode());
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")({
      type: "tool_call", toolCallId: "call-1", toolName: "write",
      input: { path: join(workspace.cwd, "file.ts"), content: "test" },
    }, ctx);

    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });

  it("keeps runtime permissions unchanged until mode persistence completes", async () => {
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return original.writeFile(...args);
    });
    const update = pi.state.setMode("yolo");

    try {
      await writing;
      const pending = await pi.event("tool_call")({
        type: "tool_call", toolCallId: "pending", toolName: "web_fetch", input: { url: "https://example.com" },
      }, ctx);
      expect(pending).toEqual({ block: true, reason: "Permission request requires interactive UI" });
      release();
      await update;

      const committed = await pi.event("tool_call")({
        type: "tool_call", toolCallId: "committed", toolName: "web_fetch", input: { url: "https://example.com" },
      }, ctx);
      expect(committed).toBeUndefined();
      expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
        .toMatchObject({ agent: { mode: "yolo" } });
    } finally {
      release();
      await update;
    }
  });

  it("keeps runtime permissions and stored mode unchanged when persistence fails", async () => {
    await writeFile(join(workspace.home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "assistant" } }));
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("write failed"));

    await expect(pi.state.setMode("yolo")).rejects.toThrow("write failed");
    const result = await pi.event("tool_call")({
      type: "tool_call", toolCallId: "failed", toolName: "web_fetch", input: { url: "https://example.com" },
    }, ctx);

    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
    expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
      .toEqual({ agent: { mode: "assistant" } });
  });
});

describe("agent mode enforcement contract", () => {
  it("lets yolo proceed for unresolved permissions but not explicit denies", async () => {
    const pi = makePermissionSession({ description: "test" }, "yolo");
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);

    const unresolved = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "unresolved", toolName: "web_fetch", input: { url: "https://example.com" } },
      ctx,
    );

    await writeFile(join(workspace.home, ".pi", "agent", "permissions.json"), JSON.stringify({ web: { "https://blocked.example": false } }));
    const denied = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "denied", toolName: "web_fetch", input: { url: "https://blocked.example" } },
      ctx,
    );

    expect(unresolved).toBeUndefined();
    expect(denied).toEqual({ block: true, reason: expect.stringContaining("denied by policy rule: https://blocked.example") });
  });

  it("keeps agent profile allowlists enforced in yolo mode", async () => {
    const pi = makePermissionSession({ description: "test", "files.read": ["allowed/**"] }, "yolo");
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "scope-denied", toolName: "read", input: { path: join(workspace.cwd, "secret.txt") } },
      makePermissionContext(workspace.cwd),
    );

    expect(result).toEqual({ block: true, reason: "Access to this resource is beyond allowed scope" });
  });

  it.each(["assistant", "restricted"] as const)("blocks non-interactive unresolved permissions in %s mode", async (mode) => {
    const pi = makePermissionSession({ description: "test" }, mode);
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "unresolved", toolName: "web_fetch", input: { url: "https://example.com" } },
      makePermissionContext(workspace.cwd),
    );

    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });
});
