import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEventBus, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import agentExtension from "../../../src/agent/index.js";
import { getState } from "../../../src/state.js";
import { getPiPath } from "../../../src/utils.js";
import { agentWorkspace } from "../../helpers/agent.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup() {
  const workspace = await agentWorkspace();
  let activeTools = ["read", "subagent", "call_mcp_tool", "list_mcp_tools"];
  const extension = recordExtension({
    events: createEventBus(),
    getAllTools: () => ["read", "subagent", "call_mcp_tool", "list_mcp_tools"].map((name) => ({
      name, description: name, parameters: Type.Object({}),
      sourceInfo: { path: "test:agent", source: "test", scope: "temporary", origin: "top-level" },
    })),
    getActiveTools: () => activeTools,
    setActiveTools: (names) => { activeTools = names; },
  });
  const notify = vi.fn<ExtensionContext["ui"]["notify"]>();
  const shutdown = vi.fn<ExtensionContext["shutdown"]>();
  const ctx = {
    cwd: workspace.cwd,
    sessionManager: { getEntries: () => [] },
    ui: { notify, setStatus: vi.fn(), theme: { fg: (_color: string, text: string) => text } },
    shutdown,
  } as unknown as ExtensionContext;
  agentExtension(extension.api);
  onTestFinished(async () => {
    await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
  });
  return {
    ...workspace,
    extension,
    notify,
    shutdown,
    start: () => extension.event("session_start")({ type: "session_start", reason: "startup" }, ctx),
  };
}

describe("agent startup", () => {

  it("requests shutdown for invalid general instead of continuing with global or unrestricted settings", async () => {
    const context = await setup();
    await writeFile(join(context.global, "general.md"), "---\ndescription: Global general\n---\nGlobal instructions");
    await writeFile(join(context.local, "general.md"), "---\ndescription: Local general\ntools: read\n---\nLocal instructions");

    await context.start();

    expect(context.shutdown).toHaveBeenCalledOnce();
    expect(context.notify).toHaveBeenCalledWith(expect.stringMatching(/Invalid agent "general".*tools/), "error");
    expect(context.extension.api.getActiveTools()).toEqual([]);
    expect(() => getState(context.extension.api)).toThrow();
  });

  it("stops startup when the local agents directory cannot be read", async () => {
    const context = await setup();
    await rm(context.local, { recursive: true });
    await writeFile(context.local, "Not a directory");

    await context.start();

    expect(context.shutdown).toHaveBeenCalledOnce();
    expect(context.notify).toHaveBeenCalledWith(expect.stringContaining("ENOTDIR"), "error");
    expect(context.extension.api.getActiveTools()).toEqual([]);
  });

  it("disposes old session state and resize listener when the next profile is invalid", async () => {
    const context = await setup();
    const listeners = process.stdout.listenerCount("resize");
    await context.start();
    const state = getState(context.extension.api);
    expect(process.stdout.listenerCount("resize")).toBe(listeners + 1);
    await writeFile(join(context.local, "general.md"), "Malformed");

    await context.start();

    expect(context.shutdown).toHaveBeenCalledOnce();
    expect(() => state.getAgent()).toThrow("unavailable");
    expect(process.stdout.listenerCount("resize")).toBe(listeners);
  });
});
