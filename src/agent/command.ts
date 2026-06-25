import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Agent } from "./types.js";
import {
  createAgentFile,
  deleteAgentFiles,
  isBuiltIn,
  loadAgents,
  writeSessionAgent,
} from "./storage.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { ScopedInput } from "../ui/components/scoped-input.js";
import { getPiPath } from "../utils.js";

const execAsync = promisify(exec);

async function openInVsCode(ctx: ExtensionCommandContext, filePath: string) {
  try {
    await execAsync("which code");
  } catch {
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
  const items: SelectEntry<Agent>[] = agents.map((agent) => ({
    value: agent.name,
    label: isBuiltIn(agent.filePath) ? `${agent.name} (built-in)` : agent.name,
    description: agent.meta.description,
    data: agent,
  }));

  return ctx.ui.custom<string | null>((_tui, theme, keybindings, done) => {
    const selectList = new ExtendedSelectList(keybindings, theme, {
      title: "Agents",
      addLabel: "Create new agent",
      items,
      maxVisibleRows: Math.min(items.length + 1, 12),
      canDelete: (item) => !isBuiltIn(item.data.filePath),
    });

    selectList.onAdd = () => done("__new__");
    selectList.onSelect = (item) => done(String(item.value));
    selectList.onCancel = () => done(null);
    selectList.onDeleteBlocked = () => ctx.ui.notify("Built-in agent cannot be deleted", "error");

    selectList.onDelete = (item) => {
      const agentName = item.data?.name ?? String(item.value);
      void deleteAgentFiles(agentName, ctx.cwd)
        .then(() => ctx.ui.notify(`Agent "${agentName}" deleted`, "info"))
        .catch(() => ctx.ui.notify(`Failed to delete agent "${agentName}"`, "error"));
    };

    return selectList;
  });
}

async function handleExistingAgent(ctx: ExtensionCommandContext, agent: Agent) {
  while (true) {
    const options = ["Start in new session", "Open in VS Code"];
    if (!isBuiltIn(agent.filePath)) options.push("Delete agent");
    const action = await ctx.ui.select(`Agent: ${agent.name}`, options);
    if (!action) return;

    if (action === "Start in new session") {
      await ctx.newSession({
        setup: async (nextSessionManager) => {
          await writeSessionAgent(ctx.cwd, nextSessionManager.getSessionId(), agent.name);
        },
      });
      return;
    }

    if (action === "Open in VS Code") {
      await openInVsCode(ctx, agent.filePath);
      return;
    }

    if (action === "Delete agent") {
      const ok = await ctx.ui.confirm(
        `Delete agent "${agent.name}"?`,
        "Removes all local and global copies of this agent.",
      );
      if (!ok) continue;
      await deleteAgentFiles(agent.name, ctx.cwd);
      ctx.ui.notify(`Agent "${agent.name}" deleted`, "info");
    }
  }
}

async function handleNewAgent(ctx: ExtensionCommandContext) {
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

  const agent = agents.find((candidate) => candidate.name === selected);
  if (agent) await handleExistingAgent(ctx, agent);
}
