import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type SelectItem, SelectList, Spacer } from "@earendil-works/pi-tui";
import { exec } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Agent } from "./types.js";
import {
  createAgentFile,
  deleteAgentFiles,
  isBuiltIn,
  loadAgents,
  setNextAgent,
} from "./storage.js";
import { Frame } from "../ui/components/frame.js";
import { ScopedInput } from "../ui/components/scoped-input.js";
import { customText, getPiPath } from "../utils.js";

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
  agents: Agent[],
): Promise<string | null> {
  const userAgents = agents.filter((agent) => !isBuiltIn(agent.filePath));
  const builtInAgents = agents.filter((agent) => isBuiltIn(agent.filePath));

  const items: SelectItem[] = [
    ...userAgents.map((agent) => ({
      value: agent.meta.name,
      label: agent.meta.name,
      description: agent.meta.description,
    })),
    {
      value: "__new__",
      label: "[Create new agent]",
      description: "Create new agent specialized for specific task(s)",
    },
  ];

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const frame = new Frame(theme);
    frame.getHints = () => [
      ["↑↓", "navigate"],
      ["enter", "select"],
      ["esc", "cancel"],
    ];

    const list = new SelectList(items, Math.min(items.length, 12), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);

    frame.addCustom(customText(theme.bold("Agents")));
    frame.addCustom(new Spacer());
    frame.addCustom(list);

    frame.addCustom(new Spacer());
    if (builtInAgents.length > 0) {
      frame.addCustom(customText(theme.fg("muted", "Built-in (always available)"), { y: 1 }));
      const dot = theme.fg("muted", "•");

      for (const agent of builtInAgents) {
        const desc = theme.fg("dim", agent.meta.description);
        frame.addCustom(customText(`  ${agent.meta.name} ${dot} ${desc}`));
      }
    }
    frame.addCustom(new Spacer());

    return {
      render: (width) => frame.render(width),
      invalidate: () => {
        frame.invalidate();
        list.invalidate();
      },
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function handleExistingAgent(ctx: ExtensionCommandContext, agent: Agent): Promise<void> {
  while (true) {
    const action = await ctx.ui.select(`Agent: ${agent.meta.name}`, [
      "Start in new session",
      "Open in VS Code",
      "Delete agent",
    ]);
    if (!action) return;

    if (action === "Start in new session") {
      await setNextAgent(ctx.cwd, ctx.sessionManager.getSessionId(), agent.meta.name);
      await ctx.newSession();
      return;
    }

    if (action === "Open in VS Code") {
      await openInVsCode(ctx, agent.filePath);
      return;
    }

    if (action === "Delete agent") {
      const ok = await ctx.ui.confirm(
        `Delete agent "${agent.meta.name}"?`,
        "Removes all local and global copies of this agent.",
      );
      if (!ok) continue;
      await deleteAgentFiles(agent.meta.name, ctx.cwd);
      ctx.ui.notify(`Agent "${agent.meta.name}" deleted`, "info");
    }
  }
}

async function handleNewAgent(ctx: ExtensionCommandContext): Promise<void> {
  const result = await ctx.ui.custom<{ name: string; scope: string } | null>(
    (_tui, theme, _kb, done) => {
      const scopedInput = new ScopedInput(theme, "Agent name");
      scopedInput.onSubmit = ({ scope, value: name }) => done({ name, scope });
      scopedInput.onCancel = () => done(null);
      return scopedInput;
    },
  );

  if (!result) return;
  const { name, scope } = result;
  const dir = getPiPath("agents", scope === "project" ? ctx.cwd : scope);
  const filePath = await createAgentFile(dir, name);

  ctx.ui.notify(`Agent created: ${filePath}`, "info");
  await openInVsCode(ctx, filePath);
}

export async function agentsCommandHandler(ctx: ExtensionCommandContext) {
  const agents = await loadAgents(ctx.cwd);
  const selected = await showAgentPicker(ctx, agents);
  if (!selected) return;

  if (selected === "__new__") {
    await handleNewAgent(ctx);
    return;
  }

  const agent = agents.find((candidate) => candidate.meta.name === selected);
  if (agent) await handleExistingAgent(ctx, agent);
}
