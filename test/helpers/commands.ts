import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionToolContext, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, type Component, type TUI } from "@earendil-works/pi-tui";
import { onTestFinished, vi } from "vitest";
import type { StoredSubsessions } from "../../src/subagent/types.js";
import { toolCapabilities } from "./extension.js";

export const PLAN_ID = "01900000-0000-7000-8000-000000000001";

export async function commandWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), "surgent-commands-"));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
  return cwd;
}

export async function storePlans(cwd: string, entries: StoredSubsessions) {
  await writeFile(join(cwd, ".pi", "subsessions.json"), JSON.stringify(entries));
}

export function planMetadata(title = "Saved plan", pid = "parent-session"): StoredSubsessions[string] {
  return {
    agent: "planner", pid, title,
    usage: {
      input: 0, output: 0, toolCalls: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "test-provider",
    model: "test-model",
    stopReason: "stop",
    timestamp: 0,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export function commandContext(cwd: string) {
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, "fg" | "bg" | "bold">;
  const ui = {
    notify: vi.fn<ExtensionCommandContext["ui"]["notify"]>(),
    custom: vi.fn<ExtensionCommandContext["ui"]["custom"]>(),
    setWidget: vi.fn<ExtensionCommandContext["ui"]["setWidget"]>(),
    theme: theme as Theme,
  };
  const values = {
    ...toolCapabilities(),
    cwd,
    mode: "tui",
    hasUI: true,
    ui,
    thinkingLevel: "off",
    model: undefined,
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "parent-session",
      getSessionFile: () => undefined,
    },
  };
  const ctx = new Proxy(values, {
    get(target, property) {
      if (!Reflect.has(target, property)) throw new Error(`Unexpected command context access: ${String(property)}`);
      return Reflect.get(target, property);
    },
  }) as unknown as ExtensionCommandContext & ExtensionToolContext;
  const tui = { requestRender: vi.fn(), terminal: { rows: 40, columns: 100 } } as unknown as TUI;
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS) as import("@earendil-works/pi-coding-agent").KeybindingsManager;

  function interact(handler: (component: Component) => void | Promise<void>) {
    ui.custom.mockImplementationOnce(async <Result>(factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
      const result = Promise.withResolvers<Result>();
      const component = await factory(tui, ui.theme, keybindings, (value) => result.resolve(value as Result));
      try {
        await handler(component);
        return await result.promise;
      } finally {
        if ("dispose" in component && typeof component.dispose === "function") component.dispose();
      }
    });
  }

  return { ctx, ui, tui, keybindings, interact };
}
