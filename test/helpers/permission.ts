import {
  createEventBus,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { onTestFinished, vi } from "vitest";
import { createState } from "../../src/state.js";
import type { AgentMeta, AgentMode } from "../../src/agent/types.js";
import { recordExtension, toolCapabilities } from "./extension.js";

export function makePermissionSession(
  meta: AgentMeta = { description: "test" },
  mode: AgentMode = "assistant",
) {
  const pi = recordExtension({ events: createEventBus() });
  const state = createState(pi.api, { name: "main", body: "", filePath: "main.md", meta }, mode);
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
    ...toolCapabilities(),
    cwd,
    hasUI,
    ui,
    sessionManager: { getSessionId: () => "session-1", getEntries: () => [] },
  };
  return new Proxy(values, {
    get(target, property) {
      if (!Reflect.has(target, property))
        throw new Error(`Unexpected context access: ${String(property)}`);
      return Reflect.get(target, property);
    },
  }) as unknown as ExtensionCommandContext & ExtensionToolContext & { ui: typeof ui };
}
