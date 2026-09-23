import type {
  ExtensionAPI, ExtensionEvent, ExtensionHandler, ProjectTrustHandler, RegisteredCommand,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export function recordExtension(capabilities: Partial<ExtensionAPI> = {}) {
  const handlers = new Map<string, Array<{ handler: unknown }>>();
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const shortcuts = new Map<Parameters<ExtensionAPI["registerShortcut"]>[0], Parameters<ExtensionAPI["registerShortcut"]>[1]>();
  // Registrations can have different parameter, detail, and render-state types.
  const tools = new Map<string, ToolDefinition<any, any, any>>();
  const methods = {
    on(name: string, handler: unknown) {
      const registration = { handler };
      const registrations = handlers.get(name) ?? [];
      registrations.push(registration);
      handlers.set(name, registrations);
      return () => {
        const index = registrations.indexOf(registration);
        if (index !== -1) registrations.splice(index, 1);
      };
    },
    registerTool(tool: ToolDefinition<any, any, any>) { tools.set(tool.name, tool); },
    registerCommand: vi.fn<ExtensionAPI["registerCommand"]>((name, command) => { commands.set(name, command); }),
    registerShortcut: vi.fn<ExtensionAPI["registerShortcut"]>((key, shortcut) => { shortcuts.set(key, shortcut); }),
    sendUserMessage: vi.fn<ExtensionAPI["sendUserMessage"]>(),
  } satisfies Pick<ExtensionAPI, "on" | "registerTool" | "registerCommand" | "registerShortcut" | "sendUserMessage">;

  return {
    // Only declared capabilities exist; this is not a Pi runtime.
    api: new Proxy(methods, {
      get(target, property) {
        if (Reflect.has(target, property)) return Reflect.get(target, property);
        if (Reflect.has(capabilities, property)) return Reflect.get(capabilities, property);
        throw new Error(`Unexpected Pi API: ${String(property)}`);
      },
    }) as unknown as ExtensionAPI,
    event<Name extends ExtensionEvent["type"]>(name: Name, index = 0) {
      const registration = handlers.get(name)?.[index];
      if (!registration) throw new Error(`Missing event registration: ${name}[${index}]`);
      // Pi exports event payloads but no event-to-result type map.
      return registration.handler as Name extends "project_trust"
        ? ProjectTrustHandler
        : ExtensionHandler<Extract<ExtensionEvent, { type: Name }>, unknown>;
    },
    command(name: string) {
      const command = commands.get(name);
      if (!command) throw new Error(`Missing command registration: ${name}`);
      return command;
    },
    shortcut(key: Parameters<ExtensionAPI["registerShortcut"]>[0]) {
      const shortcut = shortcuts.get(key);
      if (!shortcut) throw new Error(`Missing shortcut registration: ${key}`);
      return shortcut;
    },
    tool(name: string) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing tool registration: ${name}`);
      return tool;
    },
  };
}
