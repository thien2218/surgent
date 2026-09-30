import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Agent, AgentMeta, AgentProfile } from "./types.js";
import {
  createAgentFile,
  DEFAULT_AGENT,
  deleteAgentFiles,
  isBuiltIn,
  loadAgentProfiles,
  writeAgentMeta,
} from "./storage.js";
import { ExtendedSelectList } from "../ui/components/extended-select-list.js";
import { ScopedInput } from "../ui/components/scoped-input.js";
import { Form } from "../ui/components/form.js";
import { getAgentConfigForm } from "./helpers.js";
import { openInEditor } from "../utils.js";

async function showAgentPicker(
  ctx: ExtensionCommandContext,
  profiles: AgentProfile[],
): Promise<AgentProfile | "new" | null> {
  return ctx.ui.custom<AgentProfile | "new" | null>(
    (_tui, theme, _keybindings, done) => {
      const items = profiles
        .filter((profile) => profile.name !== DEFAULT_AGENT)
        .map((profile) => ({
          value: profile.filePath,
          label: `${profile.name} [${profile.scope}]${profile.error ? ` ${theme.fg("error", "(invalid)")}` : ""}`,
          description: profile.agent?.meta.description ?? profile.error,
          data: profile,
        }));

      const selectList = new ExtendedSelectList(theme, {
        title: "Agents",
        addLabel: "Create new agent",
        items,
        maxVisibleRows: 12,
        canDelete: (item) => item.data !== undefined && item.data.scope !== "built-in",
      });

      selectList.onAdd = () => done("new");
      selectList.onSelect = (item) => {
        if (!item.data) return;
        if (item.data.error !== undefined) {
          ctx.ui.notify(`Cannot select agent "${item.data.name}": ${item.data.error}`, "error");
          return;
        }
        done(item.data);
      };
      selectList.onCancel = () => done(null);
      selectList.onDeleteBlocked = () => ctx.ui.notify("Built-in agent cannot be deleted", "error");
      selectList.onDelete = (item) => {
      const agentName = item.data?.name ?? String(item.value);
      void deleteAgentFiles(agentName, ctx.cwd)
        .then(() => ctx.ui.notify(`Agent "${agentName}" deleted`, "info"))
        .catch(() => ctx.ui.notify(`Failed to delete agent "${agentName}"`, "error"));
    };

      return selectList;
    },
  );
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
      await writeAgentMeta(agent, updatedMeta);
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
      options.push("Open in external editor");
    }

    const action = await ctx.ui.select(`Agent: ${agent.name}`, options);
    if (!action) return false;

    if (action === "Start in new session") {
      const result = await ctx.newSession({
        setup: async (sessionManager) => {
          sessionManager.appendCustomEntry("agent", agent.name);
        },
      });
      return !result.cancelled;
    }
    if (action === "Edit agent config") {
      await openAgentConfigEditor(ctx, agent);
      continue;
    }
    if (action === "Open in external editor") {
      await openInEditor(ctx, agent.filePath);
      return false;
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
  await openInEditor(ctx, filePath);
}

export async function agentsCommandHandler(ctx: ExtensionCommandContext) {
  while (true) {
    const profiles = await loadAgentProfiles(ctx.cwd);
    const selected = await showAgentPicker(ctx, profiles);
    if (!selected) return;

    if (selected === "new") {
      await handleNewAgent(ctx);
      return;
    }

    if (selected.agent && (await handleExistingAgent(ctx, selected.agent))) return;
  }
}
