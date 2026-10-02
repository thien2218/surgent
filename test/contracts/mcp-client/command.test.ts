import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeAll, expect, it, onTestFinished, vi } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { readConfigFile } from "../../../src/mcp-client/storage.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionWorkspace } from "../../helpers/permission.js";

beforeAll(() => initTheme("dark", false));

async function setup(config: Record<string, unknown> = {}) {
  const workspace = await makePermissionWorkspace("surgent-mcp-command-");
  onTestFinished(workspace.restore);
  vi.stubEnv("USERPROFILE", workspace.home);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  await writeFile(join(workspace.cwd, ".pi", "mcp.json"), JSON.stringify(config));
  const recorded = recordExtension();
  mcpClient(recorded.api);
  const context = commandContext(workspace.cwd);
  const ui = Object.assign(context.ui, {
    select: vi.fn<ExtensionCommandContext["ui"]["select"]>(),
    confirm: vi.fn<ExtensionCommandContext["ui"]["confirm"]>(),
  });
  onTestFinished(async () => { await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, context.ctx); });
  return { ...context, ui, command: recorded.command("mcp") };
}

it("returns to the server menu without writing when server type selection is cancelled", async () => {
  const { command, ctx, ui, interact } = await setup();
  interact((component) => component.handleInput?.("\r"));
  interact((component) => {
    component.handleInput?.("fixture");
    component.handleInput?.("\r");
  });
  ui.select.mockResolvedValueOnce(undefined);
  interact((component) => {
    expect(component.render(100).join("\n")).toContain("MCP servers");
    component.handleInput?.("\u001b");
  });

  await command.handler("", ctx);

  expect(await readConfigFile("project", ctx.cwd)).toEqual({});
  expect(ui.notify).not.toHaveBeenCalled();
});
