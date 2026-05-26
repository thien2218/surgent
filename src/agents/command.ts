import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { exec } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedAgent } from "./frontmatter.js";
import { createAgentFile, deleteAgentFiles, isBuiltIn, loadAgents } from "./storage.js";
import { setActiveAgent } from "./states.js";
import { readFile } from "node:fs/promises";

const execAsync = promisify(exec);

async function isVsCodeAvailable(): Promise<boolean> {
  try {
    await execAsync("which code");
    return true;
  } catch {
    return false;
  }
}

async function openInVsCode(ctx: ExtensionCommandContext, filePath: string): Promise<void> {
  if (!(await isVsCodeAvailable())) {
    ctx.ui.notify("VS Code not found — install it or open the file manually: " + filePath, "error");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("code", ["--wait", filePath], { stdio: "inherit" });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`code exited ${code}`)),
    );
    child.on("error", reject);
  });
}

async function showAgentPicker(
  ctx: ExtensionCommandContext,
  agents: ParsedAgent[],
): Promise<string | null> {
  const items: SelectItem[] = [
    ...agents.map((agent) => ({
      value: agent.meta.name,
      label: agent.meta.name,
      description: agent.meta.description,
    })),
    { value: "__new__", label: "[New agent]", description: "Create a new agent file" },
  ];

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Agents")), 1, 0));

    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);

    container.addChild(new Text(theme.fg("dim", "↑↓ navigate  enter select  esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function handleExistingAgent(
  ctx: ExtensionCommandContext,
  agent: ParsedAgent,
): Promise<void> {
  const actions = ["View", "Edit", "Start in new session", "Delete"];
  const userActions = ["Edit", "Delete"];
  if (isBuiltIn(agent.meta.name)) actions.push(...userActions);

  const action = await ctx.ui.select(`Agent: ${agent.meta.name}`, actions);
  if (!action) return;

  if (action === "View") {
    const raw = await readFile(agent.filePath, "utf-8");
    ctx.ui.notify(raw, "info");
    return;
  }

  if (action === "Edit") {
    await openInVsCode(ctx, agent.filePath);
    return;
  }

  if (action === "Start in new session") {
    setActiveAgent(agent.meta.name);
    await ctx.newSession();
    return;
  }

  if (action === "Delete") {
    const ok = await ctx.ui.confirm(
      `Delete agent "${agent.meta.name}"?`,
      "Removes all local and global copies of this agent.",
    );
    if (!ok) return;
    await deleteAgentFiles(agent.meta.name, ctx.cwd);
    ctx.ui.notify(`Agent "${agent.meta.name}" deleted`, "info");
  }
}

async function handleNewAgent(ctx: ExtensionCommandContext): Promise<void> {
  const name = await ctx.ui.input("Agent name:", "my-agent");
  if (!name?.trim()) return;

  const scope = (await ctx.ui.select("Scope:", ["local", "global"])) as "local" | "global";
  if (!scope) return;

  const filePath = await createAgentFile(name.trim(), scope, ctx.cwd);
  ctx.ui.notify(`Agent created: ${filePath}`, "info");
  await openInVsCode(ctx, filePath);
}

export function registerAgentsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: async (_args, ctx) => {
      const agents = await loadAgents(ctx.cwd);
      const selected = await showAgentPicker(ctx, agents);
      if (!selected) return;

      if (selected === "__new__") {
        await handleNewAgent(ctx);
        return;
      }

      const agent = agents.find((candidate) => candidate.meta.name === selected);
      if (agent) await handleExistingAgent(ctx, agent);
    },
  });
}
