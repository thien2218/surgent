import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Agent, AgentMeta } from "./types.js";
import {
  createAgentFile,
  deleteAgentFiles,
  isBuiltIn,
  loadAgents,
  writeAgentMeta,
  writeSessionAgent,
} from "./storage.js";
import { ExtendedSelectList } from "../ui/components/extended-select-list.js";
import { ScopedInput } from "../ui/components/scoped-input.js";
import { Form } from "../ui/components/form.js";
import { getAgentConfigForm } from "./helpers.js";

const execAsync = promisify(exec);

async function openInVsCode(ctx: ExtensionCommandContext, filePath: string) {
  try {
    await execAsync("which code");
  } catch {
    ctx.ui.notify("VS Code not found — install it or open the file manually: " + filePath, "error");
    return;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("code", ["--wait", filePath], { stdio: "inherit" });
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`code exited ${code}`)),
    );
    child.on("error", rejectPromise);
  });
}

async function showAgentPicker(
  ctx: ExtensionCommandContext,
  agents: Agent[],
): Promise<string | null> {
  const items = agents.map((agent) => ({
    value: agent.name,
    label: isBuiltIn(agent.filePath) ? `${agent.name} (built-in)` : agent.name,
    description: agent.meta.description,
    data: agent,
  }));

  return ctx.ui.custom<string | null>((_tui, theme, _keybindings, done) => {
    const selectList = new ExtendedSelectList(theme, {
      title: "Agents",
      addLabel: "Create new agent",
      items,
      maxVisibleRows: 12,
      canDelete: (item) => item.data !== undefined && !isBuiltIn(item.data.filePath),
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

async function openAgentConfigEditor(ctx: ExtensionCommandContext, agent: Agent) {
  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const editor = new Form<AgentMeta>(
      tui,
      keybindings,
      theme,
      getAgentConfigForm(agent.name, agent.meta, isBuiltIn(agent.filePath)),
    );

    editor.onCancel = () => done();
    editor.onSave = async (updatedMeta) => {
      await writeAgentMeta(ctx.cwd, agent, updatedMeta);
      agent.meta = updatedMeta;
      ctx.ui.notify(`Agent "${agent.name}" config updated`, "info");
      done();
    };
    editor.onSaveError = (error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to update agent config: ${message}`, "error");
    };

    return editor;
  });
}

async function handleExistingAgent(ctx: ExtensionCommandContext, agent: Agent) {
  while (true) {
    const options = ["Start in new session", "Edit agent config"];
    if (!isBuiltIn(agent.filePath)) {
      options.push("Open in VS Code");
    }

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
    if (action === "Edit agent config") {
      await openAgentConfigEditor(ctx, agent);
      continue;
    }
    if (action === "Open in VS Code") {
      await openInVsCode(ctx, agent.filePath);
      return;
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
  const filePath = await createAgentFile(scope === "project" ? ctx.cwd : scope, name);

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
