import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import agentExtension from "../../../src/agent/index.js";
import { agentWorkspace } from "../../helpers/agent.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup() {
  const workspace = await agentWorkspace();
  initTheme("dark", false);
  const context = commandContext(workspace.cwd);
  const extension = recordExtension();
  agentExtension(extension.api);
  return { ...workspace, ...context, run: () => extension.command("agents").handler("", context.ctx) };
}

describe("agent picker", () => {
  it("marks invalid local profiles and explains rejection without falling back to global", async () => {
    const context = await setup();
    await writeFile(join(context.global, "Aprobe.md"), "---\ndescription: Global\n---\nPrompt");
    await writeFile(join(context.local, "Aprobe.md"), "---\ndescription: Local\ntools: read\n---\nPrompt");
    context.ui.theme.fg = (color, text) => color === "error" ? `\x1b[31m${text}\x1b[0m` : text;
    context.interact((component) => {
      const rendered = component.render(160).join("\n");
      expect(rendered).toContain("Aprobe [local]");
      expect(rendered).toContain("\x1b[31m(invalid)\x1b[0m");
      expect(rendered).not.toContain("Aprobe [global]");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
      expect(context.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/Cannot select agent "Aprobe".*tools/), "error");
      component.handleInput?.("\x1b");
    });

    await context.run();
  });

  it("shows custom general overrides in the picker", async () => {
    const context = await setup();
    await writeFile(join(context.local, "general.md"), "---\ndescription: Custom general\n---\nPrompt");
    context.interact((component) => {
      expect(component.render(160).join("\n")).toContain("general [local]");
      component.handleInput?.("\x1b");
    });

    await context.run();
  });

  it("reports duplicate creation without changing the existing file", async () => {
    const context = await setup();
    const filePath = join(context.local, "Aprobe.md");
    await writeFile(filePath, "Preserve original");
    context.interact((component) => component.handleInput?.("\r"));
    context.interact((component) => {
      component.handleInput?.("Aprobe");
      component.handleInput?.("\r");
    });

    await context.run();

    expect(context.ui.notify).toHaveBeenCalledWith(expect.stringContaining("already exists in selected scope"), "error");
    expect(await readFile(filePath, "utf8")).toBe("Preserve original");
  });

  it("rejects unsafe names in the creation input without closing it", async () => {
    const context = await setup();
    context.interact((component) => component.handleInput?.("\r"));
    context.interact((component) => {
      component.handleInput?.("../victim");
      component.handleInput?.("\r");
      expect(context.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Agent name must start"), "error");
      component.handleInput?.("\x1b");
    });

    await context.run();

    expect(await readdir(context.local)).toEqual([]);
  });

  it("reports deletion errors instead of success", async () => {
    const context = await setup();
    const filePath = join(context.local, "Aprobe.md");
    await writeFile(filePath, "---\ndescription: Probe\n---\nPrompt");
    context.interact(async (component) => {
      await rm(filePath);
      await mkdir(filePath);
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\x04");
      component.handleInput?.("\r");
    });
    context.interact((component) => component.handleInput?.("\x1b"));

    await context.run();

    expect(context.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Failed to delete agent "Aprobe"'), "error");
    expect(context.ui.notify).not.toHaveBeenCalledWith('Agent "Aprobe" deleted', "info");
    expect(await readdir(context.local)).toEqual(["Aprobe.md"]);
  });

  it("refreshes scope markers when deleting malformed local profile reveals global profile", async () => {
    const context = await setup();
    await writeFile(join(context.local, "Aprobe.md"), "Malformed");
    await writeFile(join(context.global, "Aprobe.md"), "---\ndescription: Global\n---\nPrompt");
    context.interact((component) => {
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\x04");
      component.handleInput?.("\r");
    });
    context.interact((component) => {
      const rendered = component.render(160).join("\n");
      expect(rendered).toContain("Aprobe [global]");
      expect(rendered).not.toContain("Aprobe [local]");
      component.handleInput?.("\x1b");
    });

    await context.run();

    expect(context.ui.notify).toHaveBeenCalledWith('Agent "Aprobe" deleted', "info");
    expect(await readdir(context.local)).toEqual([]);
  });
});
