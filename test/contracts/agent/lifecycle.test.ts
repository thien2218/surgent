import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEventBus, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import agentExtension from "../../../src/agent/index.js";
import { getState } from "../../../src/state.js";
import { resolveReadGrant } from "../../../src/permission/resolution.js";
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
    sessionManager: { getEntries: () => [], getSessionId: () => "child-session" },
    ui: { notify, setStatus: vi.fn(), theme: { fg: (_color: string, text: string) => text } },
    shutdown,
  } as unknown as ExtensionContext;
  agentExtension(extension.api);
  onTestFinished(async () => {
    await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
  });
  return {
    ...workspace,
    ctx,
    extension,
    notify,
    shutdown,
    start: () => extension.event("session_start")({ type: "session_start", reason: "startup" }, ctx),
  };
}

describe("agent startup", () => {
  it("enforces only parent policy when a saved subsession starts directly", async () => {
    const context = await setup();
    await writeFile(join(context.cwd, "private.txt"), "Harmless fixture");
    await writeFile(getPiPath("subsessions", context.cwd), JSON.stringify({
      "child-session": { pid: "parent-session" },
    }));
    await writeFile(getPiPath("permissions", context.cwd), JSON.stringify({
      "parent-session": { file: { "private.txt": "deny" } },
      "child-session": { file: { "private.txt": "read" } },
    }));

    await context.start();
    const grant = await resolveReadGrant(
      "private.txt", getState(context.extension.api), context.ctx,
    );

    expect(grant.denied).toContain("private.txt");
    expect(context.shutdown).not.toHaveBeenCalled();
  });

  it("applies the overriding general profile instead of shipped instructions", async () => {
    const context = await setup();
    await writeFile(join(context.local, "general.md"), "---\ndescription: Local general\ntools: [read]\n---\nLocal instructions");

    await context.start();

    expect(getState(context.extension.api).getAgent().body).toBe("Local instructions");
    expect(context.extension.api.getActiveTools()).toEqual(["read"]);
    expect(context.shutdown).not.toHaveBeenCalled();
  });

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

describe("generated tool details", () => {
  it.each(["subagent", "call_mcp_tool", "list_mcp_tools"])(
    "clears stale details when %s is disabled and no related tool remains", async (tool) => {
      const context = await setup();
      const filePath = join(context.local, "general.md");
      await writeFile(filePath, `---\ndescription: General\ntools: [${tool}]\n---\nInstructions`);
      await context.start();
      expect(await readFile(getPiPath("system"), "utf8")).toContain("## Available");

      await writeFile(filePath, "---\ndescription: General\ntools: []\n---\nInstructions");
      await context.start();

      expect(await readFile(getPiPath("system"), "utf8")).toBe("");
      expect(context.shutdown).not.toHaveBeenCalled();
    },
  );
});
