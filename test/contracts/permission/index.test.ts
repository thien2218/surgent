import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import permissionExtension from "../../../src/permission/index.js";
import { readAgentMode, writeAgentMode } from "../../../src/permission/storage.js";
import { createPermissionSandbox } from "../../helpers/permission.js";
import { testTheme } from "../../helpers/tui.js";

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
});

function createRecorder() {
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const commands = new Map<string, unknown>();
  const shortcuts: unknown[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const notifications: Array<[string, string]> = [];
  const pi = {
    on: (name: string, handler: (...args: unknown[]) => unknown) => events.set(name, handler),
    registerCommand: (name: string, command: unknown) => commands.set(name, command),
    registerShortcut: (_key: unknown, shortcut: unknown) => shortcuts.push(shortcut),
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: () => undefined,
    setModel: async () => true,
    setThinkingLevel: () => undefined,
    sendUserMessage: () => undefined,
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: sandbox.cwd,
    hasUI: true,
    sessionManager: { getEntries: () => [], getSessionId: () => "session-1" },
    modelRegistry: { find: () => undefined },
    ui: {
      theme: testTheme,
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      notify: (message: string, level: string) => notifications.push([message, level]),
    },
  } as unknown as ExtensionContext;
  return { pi, ctx, events, commands, shortcuts, statuses, notifications };
}

describe("permission extension registration", () => {
  it("registers permission command, mode shortcut, and lifecycle hooks", () => {
    const recorder = createRecorder();

    permissionExtension(recorder.pi);

    expect([...recorder.commands.keys()]).toEqual(["permissions"]);
    expect(recorder.shortcuts).toHaveLength(1);
    expect([...recorder.events.keys()]).toEqual([
      "session_start",
      "before_agent_start",
      "session_shutdown",
      "tool_call",
    ]);
  });

  it("initializes persisted mode and statuses at startup", async () => {
    await writeAgentMode("restricted");
    const recorder = createRecorder();
    permissionExtension(recorder.pi);
    const sessionStart = recorder.events.get("session_start")!;
    const sessionShutdown = recorder.events.get("session_shutdown")!;

    try {
      await sessionStart({}, recorder.ctx);

      expect(recorder.statuses.some(([key, value]) => key === "agent" && value === "agent: general"))
        .toBe(true);
      expect(
        recorder.statuses.some(
          ([key, value]) => key === "mode" && value?.includes("restricted mode"),
        ),
      ).toBe(true);
    } finally {
      await sessionShutdown({}, recorder.ctx);
    }
  });

  it("prepends the loaded agent prompt", async () => {
    const recorder = createRecorder();
    permissionExtension(recorder.pi);
    const sessionStart = recorder.events.get("session_start")!;
    const beforeAgentStart = recorder.events.get("before_agent_start")!;
    const sessionShutdown = recorder.events.get("session_shutdown")!;

    try {
      await sessionStart({}, recorder.ctx);
      const result = beforeAgentStart({ systemPrompt: "base prompt" }, recorder.ctx) as {
        systemPrompt: string;
      };

      expect(result.systemPrompt).toContain("base prompt");
      expect(result.systemPrompt).not.toBe("base prompt");
    } finally {
      await sessionShutdown({}, recorder.ctx);
    }
  });

  it("cycles and persists mode through the registered shortcut", async () => {
    const recorder = createRecorder();
    permissionExtension(recorder.pi);
    const sessionStart = recorder.events.get("session_start")!;
    const sessionShutdown = recorder.events.get("session_shutdown")!;
    const shortcut = recorder.shortcuts[0] as {
      handler: (ctx: ExtensionContext) => Promise<void>;
    };

    try {
      await sessionStart({}, recorder.ctx);
      await shortcut.handler(recorder.ctx);

      expect(await readAgentMode()).toBe("yolo");
      expect(recorder.notifications).toContainEqual([
        "YOLO mode ON - agents can now run commands and tools without asking",
        "info",
      ]);
      expect(
        recorder.statuses.some(([key, value]) => key === "mode" && value?.includes("YOLO mode")),
      ).toBe(true);
    } finally {
      await sessionShutdown({}, recorder.ctx);
    }
  });

  it("replaces its resize listener and removes it on shutdown", async () => {
    const recorder = createRecorder();
    permissionExtension(recorder.pi);
    const sessionStart = recorder.events.get("session_start")!;
    const sessionShutdown = recorder.events.get("session_shutdown")!;
    const baseline = process.stdout.listenerCount("resize");

    try {
      await sessionStart({}, recorder.ctx);
      expect(process.stdout.listenerCount("resize")).toBe(baseline + 1);

      await sessionStart({}, recorder.ctx);
      expect(process.stdout.listenerCount("resize")).toBe(baseline + 1);

      await sessionShutdown({}, recorder.ctx);
      expect(process.stdout.listenerCount("resize")).toBe(baseline);

      await sessionShutdown({}, recorder.ctx);
      expect(process.stdout.listenerCount("resize")).toBe(baseline);
    } finally {
      await sessionShutdown({}, recorder.ctx);
    }
  });
});
