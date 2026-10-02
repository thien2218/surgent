import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { recordExtension } from "../../helpers/extension.js";

export function loginSetup(options: { input?: string; mode?: ExtensionCommandContext["mode"]; hasUI?: boolean } = {}) {
  const credentials = new Map<string, { type: string; key?: string }>();
  const read = vi.fn(async (provider: string) => credentials.get(provider));
  const modify = vi.fn(async (provider: string, update: () => Promise<{ type: string; key: string }>) => {
    credentials.set(provider, await update());
  });
  const remove = vi.fn(async (provider: string) => { credentials.delete(provider); });
  const dialog = { value: options.input };
  const custom = vi.fn(async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => new Promise((resolve, reject) => {
    const component = factory(
      { requestRender() {} } as unknown as TUI,
      { fg: (_color: string, text: string) => text } as Theme,
      {} as Parameters<Parameters<ExtensionCommandContext["ui"]["custom"]>[0]>[2],
      resolve,
    );
    Promise.resolve(component).then(screen => {
      screen.handleInput?.(dialog.value === undefined ? "\x1b" : dialog.value);
      if (dialog.value !== undefined) screen.handleInput?.("\r");
    }).catch(reject);
  }));
  const ui = {
    select: vi.fn<ExtensionCommandContext["ui"]["select"]>().mockResolvedValue("Save new API key"),
    confirm: vi.fn<ExtensionCommandContext["ui"]["confirm"]>().mockResolvedValue(true),
    input: vi.fn<ExtensionCommandContext["ui"]["input"]>(),
    notify: vi.fn<ExtensionCommandContext["ui"]["notify"]>(),
    custom,
  };
  const ctx = {
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? "tui",
    modelRegistry: { runtime: { credentials: { read, modify, delete: remove } } },
    ui,
  } as unknown as ExtensionCommandContext;
  const extension = recordExtension();
  webTools(extension.api);
  return { command: extension.command("web-login"), ctx, ui, credentials, read, modify, remove, dialog };
}
