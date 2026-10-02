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

it("rejects noninteractive management without opening UI or changing config", async () => {
  const { command, ctx, ui } = await setup();

  await command.handler("", { ...ctx, hasUI: false });

  expect(ui.notify).toHaveBeenCalledWith("/mcp requires an interactive UI.", "error");
  expect(ui.custom).not.toHaveBeenCalled();
  expect(await readConfigFile("project", ctx.cwd)).toEqual({});
});

it.each(["name", "config"])("cancels the %s prompt without saving a server", async (stage) => {
  const { command, ctx, ui, interact } = await setup();
  interact((component) => component.handleInput?.("\r"));
  interact((component) => {
    if (stage === "name") component.handleInput?.("\u001b");
    else {
      component.handleInput?.("fixture");
      component.handleInput?.("\r");
    }
  });
  if (stage === "config") {
    ui.select.mockResolvedValueOnce("Local");
    interact((component) => component.handleInput?.("\u001b"));
  }
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect(await readConfigFile("project", ctx.cwd)).toEqual({});
  expect(ui.notify).not.toHaveBeenCalled();
});

it.each([
  { choice: "Local", field: "command", value: "fixture-command", transport: "stdio" },
  { choice: "Remote", field: "url", value: "http://localhost/mcp", transport: "http" },
])("saves a disabled $choice server from form input", async ({ choice, field, value, transport }) => {
  const { command, ctx, ui, interact } = await setup();
  interact((component) => component.handleInput?.("\r"));
  interact((component) => {
    component.handleInput?.("fixture");
    component.handleInput?.("\r");
  });
  ui.select.mockResolvedValueOnce(choice);
  interact((component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\r");
    component.handleInput?.(value);
    component.handleInput?.("\r");
    component.handleInput?.("\u0013");
  });
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect(await readConfigFile("project", ctx.cwd)).toEqual({ fixture: { transport, [field]: value, enabled: false } });
  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Saved MCP server fixture"), "info");
});

it("preserves an existing server when replacement confirmation is declined", async () => {
  const config = { fixture: { transport: "stdio", command: "original", enabled: false } };
  const { command, ctx, ui, interact } = await setup(config);
  interact((component) => component.handleInput?.("\r"));
  interact((component) => {
    component.handleInput?.("fixture");
    component.handleInput?.("\r");
  });
  ui.confirm.mockResolvedValueOnce(false);
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect(ui.confirm).toHaveBeenCalledOnce();
  expect(ui.select).not.toHaveBeenCalled();
  expect(await readConfigFile("project", ctx.cwd)).toEqual(config);
});

it("keeps an existing server unchanged when its edit form is cancelled", async () => {
  const config = { fixture: { transport: "stdio", command: "original", enabled: false } };
  const { command, ctx, ui, interact } = await setup(config);
  interact((component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\r");
  });
  interact((component) => component.handleInput?.("\u001b"));
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect(await readConfigFile("project", ctx.cwd)).toEqual(config);
  expect(ui.notify).not.toHaveBeenCalled();
});

it("reports a failed enable check and leaves the server disabled", async () => {
  const config = { fixture: { transport: "stdio", command: "unused", enabled: false } };
  const { command, ctx, ui, tui, interact } = await setup(config);
  config.fixture.command = join(ctx.cwd, "missing-executable");
  await writeFile(join(ctx.cwd, ".pi/mcp.json"), JSON.stringify(config));
  const finished = Promise.withResolvers<void>();
  interact(async (component) => {
    tui.requestRender = () => {
      if (!component.render(100).join("\n").includes("checking")) finished.resolve();
    };
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\t");
    await finished.promise;
    component.handleInput?.("\u001b");
  });

  await command.handler("", ctx);

  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("ENOENT"), "error");
  expect(await readConfigFile("project", ctx.cwd)).toEqual(config);
});

it("disables an enabled server without requiring a live connection", async () => {
  const { command, ctx, ui, tui, interact } = await setup({
    fixture: { transport: "stdio", command: "unused-fixture-command", enabled: true },
  });
  const finished = Promise.withResolvers<void>();
  tui.requestRender = () => finished.resolve();
  interact(async (component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\t");
    await finished.promise;
    component.handleInput?.("\u001b");
  });

  await command.handler("", ctx);

  expect((await readConfigFile("project", ctx.cwd)).fixture).toMatchObject({ enabled: false });
  expect(ui.notify).not.toHaveBeenCalled();
});

it("removes a server only after deletion is confirmed", async () => {
  const { command, ctx, ui, tui, interact } = await setup({
    fixture: { transport: "stdio", command: "unused-fixture-command", enabled: false },
  });
  const finished = Promise.withResolvers<void>();
  tui.requestRender = () => finished.resolve();
  interact(async (component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\u0004");
    expect((await readConfigFile("project", ctx.cwd)).fixture).toBeDefined();
    component.handleInput?.("\r");
    await finished.promise;
    component.handleInput?.("\u001b");
  });

  await command.handler("", ctx);

  expect(await readConfigFile("project", ctx.cwd)).toEqual({});
  expect(ui.notify).not.toHaveBeenCalled();
});

it("saves edited form values through the command", async () => {
  const { command, ctx, ui, interact } = await setup({
    fixture: { transport: "stdio", command: "original", enabled: false },
  });
  interact((component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\r");
  });
  interact((component) => {
    for (let index = 0; index < 4; index++) component.handleInput?.("\u001b[B");
    component.handleInput?.("\r");
    component.handleInput?.("updated description");
    component.handleInput?.("\r");
    component.handleInput?.("\u0013");
  });
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect((await readConfigFile("project", ctx.cwd)).fixture).toEqual({
    transport: "stdio", command: "original", enabled: false, description: "updated description",
  });
  expect(ui.notify).toHaveBeenCalledWith("Updated MCP server fixture.", "info");
});

it("reports an edit collision and preserves both saved servers", async () => {
  const config = {
    fixture: { transport: "stdio", command: "original", enabled: false },
    fixturetaken: { transport: "stdio", command: "keep", enabled: false },
  };
  const { command, ctx, ui, interact } = await setup(config);
  const failed = Promise.withResolvers<void>();
  ui.notify.mockImplementation((_message, level) => { if (level === "error") failed.resolve(); });
  interact((component) => {
    component.handleInput?.("\u001b[B");
    component.handleInput?.("\r");
  });
  interact(async (component) => {
    component.handleInput?.("\r");
    component.handleInput?.("taken");
    component.handleInput?.("\r");
    component.handleInput?.("\u0013");
    await failed.promise;
    component.handleInput?.("\u001b");
  });
  interact((component) => component.handleInput?.("\u001b"));

  await command.handler("", ctx);

  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("already exists"), "error");
  expect(await readConfigFile("project", ctx.cwd)).toEqual(config);
});
