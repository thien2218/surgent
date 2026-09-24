import { createEventBus, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { onTestFinished, vi } from "vitest";
import { createState } from "../../src/state.js";
import type { AgentMeta, AgentMode } from "../../src/agent/types.js";
import { recordExtension } from "./extension.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PermissionWorkspace {
  root: string;
  home: string;
  cwd: string;
  restore: () => Promise<void>;
}

export async function makePermissionWorkspace(prefix = "surgent-permission-", changeCwd = false): Promise<PermissionWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, "home");
  const cwd = join(root, "work");
  const oldHome = process.env.HOME;
  const oldCwd = process.cwd();

  try {
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });
    if (changeCwd) process.chdir(cwd);
    process.env.HOME = home;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    home,
    cwd,
    restore: async () => {
      if (changeCwd) process.chdir(oldCwd);
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function makePermissionSession(meta: AgentMeta = { description: "test" }, mode: AgentMode = "assistant") {
  const pi = recordExtension({ events: createEventBus() });
  const state = createState(pi.api, { name: "main", body: "", filePath: "main.md", meta }, mode, () => {});
  onTestFinished(() => state.dispose());
  return { ...pi, state };
}

export function makePermissionContext(cwd: string, hasUI = false) {
  const ui = {
    setStatus: vi.fn<ExtensionContext["ui"]["setStatus"]>(),
    notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
    custom: vi.fn<ExtensionContext["ui"]["custom"]>(),
    theme: { fg: vi.fn<ExtensionContext["ui"]["theme"]["fg"]>((_color, text) => text) },
  };
  const values = {
    cwd, hasUI, ui,
    sessionManager: { getSessionId: () => "session-1", getEntries: () => [] },
  };
  return new Proxy(values, {
    get(target, property) {
      if (!Reflect.has(target, property)) throw new Error(`Unexpected context access: ${String(property)}`);
      return Reflect.get(target, property);
    },
  }) as unknown as ExtensionCommandContext & { ui: typeof ui };
}
