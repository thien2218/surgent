import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import permissionExtension from "../../../src/permission/index.js";
import { makePermissionContext, makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { recordExtension } from "../../helpers/extension.js";

vi.mock("../../../src/agent/storage.js", () => ({
  loadMainAgent: vi.fn(async () => ({
    name: "main", body: "agent body", meta: { description: "test" }, filePath: "main.md",
  })),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

let workspace: PermissionWorkspace;
let sessions: Array<ReturnType<typeof recordExtension>>;

beforeEach(async () => {
  sessions = [];
  vi.mocked(writeFile).mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).writeFile);
  workspace = await makePermissionWorkspace("surgent-mode-contract-");
});

afterEach(async () => {
  try {
    for (const session of sessions) {
      await session.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, makePermissionContext(workspace.cwd));
    }
  } finally {
    await workspace.restore();
    vi.restoreAllMocks();
  }
});

describe("permission extension agent mode contract", () => {
  it("loads stored mode on session start and applies it to tool calls", async () => {
    await writeFile(join(workspace.home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "restricted" } }));
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);
    sessions.push(pi);

    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const result = await pi.event("tool_call")({
      type: "tool_call", toolCallId: "call-1", toolName: "write",
      input: { path: join(workspace.cwd, "file.ts"), content: "test" },
    }, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", expect.stringContaining("restricted mode"));
    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });

  it("keeps runtime permissions unchanged until mode persistence completes", async () => {
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);
    sessions.push(pi);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let entered!: () => void;
    let release!: () => void;
    let notified!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saved = new Promise<void>((resolve) => { notified = resolve; });
    ctx.ui.notify.mockImplementation(() => { notified(); });
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return original.writeFile(...args);
    });

    try {
      pi.shortcut("alt+m").handler(ctx);
      await writing;
      const pending = await pi.event("tool_call")({
        type: "tool_call", toolCallId: "pending", toolName: "web_fetch", input: { url: "https://example.com" },
      }, ctx);
      expect(pending).toEqual({ block: true, reason: "Permission request requires interactive UI" });
      expect(ctx.ui.setStatus).not.toHaveBeenCalledWith("mode", expect.stringContaining("YOLO mode"));
      release();
      await saved;

      const committed = await pi.event("tool_call")({
        type: "tool_call", toolCallId: "committed", toolName: "web_fetch", input: { url: "https://example.com" },
      }, ctx);
      expect(committed).toBeUndefined();
      expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
        .toMatchObject({ agent: { mode: "yolo" } });
      expect(ctx.ui.notify).toHaveBeenCalledWith("Mode: yolo", "info");
    } finally {
      release();
      await saved;
    }
  });

  it("keeps runtime permissions and stored mode unchanged when persistence fails", async () => {
    await writeFile(join(workspace.home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "assistant" } }));
    const pi = recordExtension();
    const ctx = makePermissionContext(workspace.cwd);
    permissionExtension(pi.api);
    sessions.push(pi);
    await pi.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    let notified!: () => void;
    const failed = new Promise<void>((resolve) => { notified = resolve; });
    ctx.ui.notify.mockImplementation(() => { notified(); });
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("write failed"));

    pi.shortcut("alt+m").handler(ctx);
    await failed;
    const result = await pi.event("tool_call")({
      type: "tool_call", toolCallId: "failed", toolName: "web_fetch", input: { url: "https://example.com" },
    }, ctx);

    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to change mode, please try again", "error");
    expect(ctx.ui.setStatus).not.toHaveBeenCalledWith("mode", expect.stringContaining("YOLO mode"));
    expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
      .toEqual({ agent: { mode: "assistant" } });
  });
});
