import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  loadMcpConfigSet,
  normalizeServerConfig,
  readConfigFile,
  updateServerConfig,
} from "./storage.js";
import type { McpServer, McpTransport, ResolvedMcpServer } from "./types.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { ScopedInput } from "../ui/components/scoped-input.js";
import { Form } from "../ui/components/form.js";
import { McpClientManager } from "./client.js";
import { parseEditConfigValues } from "./validation.js";
import { getEditFields, saveEditedServer } from "./helpers.js";

export async function mcpCommandHandler(_args: string, ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/mcp requires an interactive UI.", "error");
    return;
  }

  while (true) {
    const action = await showMcpOptions(ctx);
    if (!action) return;

    if (action.addMcp) {
      await handleSaveFlow(ctx);
      continue;
    }

    if (action.selectedServer) {
      await handleEditFlow(ctx, action.selectedServer);
    }
  }
}

async function showMcpOptions(
  ctx: ExtensionCommandContext,
): Promise<{ addMcp: boolean; selectedServer?: ResolvedMcpServer } | null> {
  const configuredServers = await loadMcpConfigSet(ctx.cwd);
  const items = configuredServers.map((server) => ({
    value: server.name,
    label: `${server.name} [${server.scope}]`,
    description: server.enabled ? "enabled" : "disabled",
    data: server,
  }));

  return ctx.ui.custom<{ addMcp: boolean; selectedServer?: ResolvedMcpServer } | null>(
    (tui, theme, _keybindings, done) => {
      let isPending = false;
      const selectList = new ExtendedSelectList<ResolvedMcpServer>(theme, {
        title: "MCP servers",
        addLabel: "Add MCP server",
        items,
        maxVisibleRows: 12,
      });

      const refresh = (pending = false) => {
        isPending = pending;
        selectList.invalidate();
        tui.requestRender();
      };

      const handleServer = (item: SelectEntry<ResolvedMcpServer>, isDelete: boolean) => {
        if (!item.data || isPending) return;
        isPending = true;

        if (isDelete) {
          deleteMcpServer(ctx, item).finally(refresh);
        } else {
          toggleMcpServer(ctx, item, refresh).finally(refresh);
        }
      };

      selectList.onAdd = () => done({ addMcp: true });
      selectList.onCancel = () => done(null);
      selectList.onSelect = (item) => done({ addMcp: false, selectedServer: item.data });
      selectList.onDelete = (item) => handleServer(item, true);
      selectList.extendKb(Key.tab, (item) => handleServer(item, false), "enable/disable");

      return selectList;
    },
  );
}

async function toggleMcpServer(
  ctx: ExtensionCommandContext,
  item: SelectEntry<ResolvedMcpServer>,
  refresh: (pending: boolean) => void,
) {
  const server = item.data;
  if (!server) return;

  const nextEnabledState = !server.enabled;
  if (nextEnabledState) {
    item.description = "checking";
    const client = new McpClientManager();
    refresh(true);

    try {
      await client.listTools({ ...server, enabled: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to check MCP server";
      ctx.ui.notify(errorMessage, "error");
      item.description = "disabled";
      return;
    } finally {
      await client.disposeAll();
    }
  }

  const { name, ...config } = server;
  const updatedConfig: McpServer = { ...config, enabled: nextEnabledState };

  try {
    await updateServerConfig(server.scope, ctx.cwd, name, {
      config: updatedConfig,
      kind: "upsert",
    });
    const updated = { ...server, enabled: nextEnabledState };
    item.data = updated;
    item.description = updated.enabled ? "enabled" : "disabled";
  } catch (error) {
    item.description = server.enabled ? "enabled" : "disabled";
    const errorMessage = error instanceof Error ? error.message : "Failed to update MCP server";
    ctx.ui.notify(errorMessage, "error");
  }
}

async function deleteMcpServer(ctx: ExtensionCommandContext, item: SelectEntry<ResolvedMcpServer>) {
  const server = item.data;
  if (!server) return;

  try {
    const result = await updateServerConfig(server.scope, ctx.cwd, server.name, {
      kind: "delete",
    });
    if (!result.updated) {
      ctx.ui.notify(`MCP server ${server.name} no longer exists in ${result.path}.`, "warning");
      return;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to delete MCP server";
    ctx.ui.notify(errorMessage, "error");
  }
}

async function handleEditFlow(ctx: ExtensionCommandContext, server: ResolvedMcpServer) {
  if (!ctx.hasUI) {
    ctx.ui.notify("mcp edit requires an interactive UI.", "error");
    return;
  }

  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const editor = new Form<ResolvedMcpServer>(tui, keybindings, theme, {
      title: `Edit MCP server: ${server.name}`,
      fields: getEditFields(server),
      emptyMessage: "No fields available for editing.",
      parseOnSave: parseEditConfigValues,
    });

    editor.onCancel = () => done();
    editor.onSave = async (updatedServer) => {
      await saveEditedServer(ctx, server, updatedServer);
      done();
    };
    editor.onSaveError = (error) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to update MCP server: ${message}`, "error");
    };

    return editor;
  });
}

async function handleSaveFlow(ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("mcp save requires an interactive UI.", "error");
    return;
  }

  const result = await ctx.ui.custom<{ name: string; scope: string } | null>(
    (_tui, theme, _kb, done) => {
      const scopedInput = new ScopedInput(theme, "MCP server name");
      scopedInput.onSubmit = ({ scope, value: name }) => done({ name, scope });
      scopedInput.onCancel = () => done(null);
      return scopedInput;
    },
  );

  if (!result) return;
  const { name, scope } = result;
  if (scope !== "project" && scope !== "global") {
    ctx.ui.notify(`Invalid scope: ${scope}`, "error");
    return;
  }

  const configuredServers = await readConfigFile(scope, ctx.cwd);
  const hasExisting = Object.hasOwn(configuredServers, name);

  if (hasExisting) {
    const confirmed = await ctx.ui.confirm(
      `Replace ${name} MCP`,
      `${name} MCP already exists ${scope}ly. Do you want to replace it?`,
    );
    if (!confirmed) return;
  }

  const transportType = await ctx.ui.select("Server type", ["Remote", "Local"]);
  const transport = transportType === "Remote" ? "http" : "stdio";

  const config = await promptServerConfig(ctx, transport, name, scope, configuredServers[name]);
  if (!config) return;

  const upsertResult = await updateServerConfig(scope, ctx.cwd, name, {
    config,
    kind: "upsert",
  });
  ctx.ui.notify(
    `${upsertResult.updated ? "Updated" : "Saved"} MCP server ${name} ${scope}ly (${upsertResult.path}).`,
    "info",
  );
}

async function promptServerConfig(
  ctx: ExtensionCommandContext,
  transport: McpTransport,
  name: string,
  scope: "project" | "global",
  existingConfig?: McpServer,
): Promise<McpServer | undefined> {
  const defaults =
    transport === "http"
      ? { name, scope, transport, url: "" }
      : { name, scope, transport, command: "" };
  const server: ResolvedMcpServer = existingConfig ? { name, scope, ...existingConfig } : defaults;

  return ctx.ui.custom<McpServer | undefined>((tui, theme, keybindings, done) => {
    const editor = new Form<McpServer>(tui, keybindings, theme, {
      title: `Configure ${name} MCP server`,
      fields: getEditFields(server).filter(
        (field) => !["name", "scope", "transport"].includes(field.key),
      ),
      parseOnSave: (values) =>
        normalizeServerConfig(name, parseEditConfigValues({ ...values, name, scope, transport })),
    });

    editor.onCancel = () => done(undefined);
    editor.onSave = (serverConfig) => done(serverConfig);
    editor.onSaveError = (error) => {
      ctx.ui.notify(error instanceof Error ? error.message : "Invalid MCP server config", "error");
    };

    return editor;
  });
}
