import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import permissionExtension from "../../../src/permission/index.js";

type FakeContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    setStatus: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    theme: { fg: ReturnType<typeof vi.fn> };
  };
  sessionManager: {
    getEntries: () => unknown[];
    getSessionId: () => string;
  };
};

vi.mock("../../../src/agent/storage.js", () => ({
  loadMainAgent: vi.fn(async () => ({
    name: "main",
    body: "agent body",
    meta: { description: "test" },
    filePath: "main.md",
  })),
}));

let root: string;
let home: string;
let cwd: string;
let oldHome: string | undefined;
let shutdowns: Array<() => unknown>;

beforeEach(async () => {
  shutdowns = [];
  root = await mkdtemp(join(tmpdir(), "surgent-mode-contract-"));
  home = join(root, "home");
  cwd = join(root, "work");
  oldHome = process.env.HOME;
  process.env.HOME = home;
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
});

afterEach(async () => {
  for (const shutdown of shutdowns) await shutdown();
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("permission extension agent mode contract", () => {
  it("loads stored mode on session start and applies it to tool calls", async () => {
    await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "restricted" } }));
    const pi = fakePi();
    const ctx = fakeContext();

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    const result = await pi.events.tool_call?.(
      { toolName: "write", input: { path: join(cwd, "file.ts") } },
      ctx,
    );

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("mode", expect.stringContaining("restricted mode"));
    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });

  it("persists shortcut mode changes before updating runtime status", async () => {
    const pi = fakePi();
    const ctx = fakeContext();

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    pi.shortcut.handler(ctx);

    await vi.waitFor(async () => {
      await expect(readJson(join(home, ".pi", "agent", "settings.json"))).resolves.toMatchObject({
        agent: { mode: "yolo" },
      });
    });
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("mode", expect.stringContaining("YOLO mode"));
    expect(ctx.ui.notify).toHaveBeenCalledWith("Mode: yolo", "info");
  });

  it("keeps runtime mode unchanged when shortcut persistence fails", async () => {
    await mkdir(join(home, ".pi", "agent", "settings.json"));
    const pi = fakePi();
    const ctx = fakeContext();

    permissionExtension(pi.api);
    await pi.events.session_start?.({}, ctx);
    pi.shortcut.handler(ctx);

    await vi.waitFor(() => {
      expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to change mode, please try again", "error");
    });
    expect(ctx.ui.setStatus).not.toHaveBeenCalledWith("mode", expect.stringContaining("YOLO mode"));
  });
});

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

function fakePi() {
  const events: Record<string, ((event: unknown, ctx: FakeContext) => unknown) | undefined> = {};
  let shortcut: { handler: (ctx: FakeContext) => void } | undefined;
  shutdowns.push(() => events.session_shutdown!({}, fakeContext()));
  return {
    events,
    get shortcut() {
      if (!shortcut) throw new Error("shortcut not registered");
      return shortcut;
    },
    api: {
      registerShortcut: vi.fn((_key, registered) => {
        shortcut = registered;
      }),
      registerCommand: vi.fn(),
      on: vi.fn((name, handler) => {
        events[name] = handler;
      }),
      sendUserMessage: vi.fn(),
    } as never,
  };
}

function fakeContext(): FakeContext {
  return {
    cwd,
    hasUI: false,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      theme: { fg: vi.fn((_name: string, text: string) => text) },
    },
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => "session-1",
    },
  };
}
