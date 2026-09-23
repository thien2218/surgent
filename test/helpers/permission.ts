import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PermissionWorkspace {
  root: string;
  home: string;
  cwd: string;
  restore: () => Promise<void>;
}

export async function makePermissionWorkspace(prefix = "surgent-permission-"): Promise<PermissionWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, "home");
  const cwd = join(root, "work");
  const oldHome = process.env.HOME;

  process.env.HOME = home;
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });

  return {
    root,
    home,
    cwd,
    restore: async () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      await rm(root, { recursive: true, force: true });
    },
  };
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
