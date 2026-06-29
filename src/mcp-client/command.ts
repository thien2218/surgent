import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Spacer } from "@earendil-works/pi-tui";
import {
  loadMcpConfigSet,
  normalizeServerConfig,
  readConfigFile,
  updateServerConfig,
} from "./storage.js";
import type { McpServer, McpTransport, ResolvedMcpServer } from "./types.js";
import { customText, getPiPath } from "../utils.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { Frame } from "../ui/components/frame.js";
import { PlaceholderInput } from "../ui/components/placeholder-input.js";
import { ScopedInput } from "../ui/components/scoped-input.js";

export async function mcpConfigCommandHandler(args: string, ctx: ExtensionCommandContext) {
  if (args.trim().length > 0) {
    ctx.ui.notify("Usage: /mcp (no arguments)", "error");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify("/mcp requires an interactive UI.", "error");
    return;
  }

  while (true) {
    const action = await showMcpOptions(ctx);
    if (action === "cancel") return;
    await handleSaveFlow(ctx);
  }
}

async function showMcpOptions(ctx: ExtensionCommandContext): Promise<"add" | "cancel"> {
  const configuredServers = await loadMcpConfigSet(ctx.cwd);
  const items = configuredServers.map((server) => ({
    value: server.name,
    label: `${server.name} [${server.scope}]`,
    description: describeEnabledState(server),
    data: server,
  }));

  return ctx.ui.custom<"add" | "cancel">((tui, theme, _keybindings, done) => {
    let isPending = false;
    const selectList = new ExtendedSelectList<ResolvedMcpServer>(theme, {
      title: "MCP servers",
      addLabel: "Add MCP server",
      items,
      maxVisibleRows: 12,
    });

    const handleServer = (
      item: SelectEntry<ResolvedMcpServer>,
      handler: typeof toggleMcpServer,
    ) => {
      if (!item.data || isPending) return;
      isPending = true;
      handler(ctx, item).finally(() => {
        isPending = false;
        selectList.invalidate();
        tui.requestRender();
      });
    };

    selectList.onAdd = () => done("add");
    selectList.onSelect = (item) => handleServer(item, toggleMcpServer);
    selectList.onDelete = (item) => handleServer(item, deleteMcpServer);
    selectList.onCancel = () => done("cancel");

    return selectList;
  });
}

function describeEnabledState(server: ResolvedMcpServer): string {
  const statusLabel = server.enabled ? "Enabled" : "Disabled";
  if (!server.description) {
    return statusLabel;
  }
  return `${statusLabel} • ${server.description}`;
}

async function toggleMcpServer(ctx: ExtensionCommandContext, item: SelectEntry<ResolvedMcpServer>) {
  const server = item.data;
  if (!server) return;

  const { name, scope, sourcePath, ...config } = server;
  const nextEnabledState = !server.enabled;
  const updatedConfig: McpServer = { ...config, enabled: nextEnabledState };

  try {
    await updateServerConfig(sourcePath, name, { config: updatedConfig, kind: "upsert" });
    const updatedServer = { ...server, enabled: nextEnabledState };
    item.data = updatedServer;
    item.description = describeEnabledState(updatedServer);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to update MCP server";
    ctx.ui.notify(errorMessage, "error");
  }
}

async function deleteMcpServer(ctx: ExtensionCommandContext, item: SelectEntry<ResolvedMcpServer>) {
  const server = item.data;
  if (!server) return;

  try {
    const result = await updateServerConfig(server.sourcePath, server.name, { kind: "delete" });
    if (!result.updated) {
      ctx.ui.notify(`MCP server ${server.name} no longer exists in ${result.path}.`, "warning");
      return;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to delete MCP server";
    ctx.ui.notify(errorMessage, "error");
  }
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

  const configuredServers = await readConfigFile(
    getPiPath("mcp", scope === "project" ? ctx.cwd : scope),
  );
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

  const config = await promptServerConfig(ctx, transport, name, configuredServers[name]);
  if (!config) return;

  const path = getPiPath("mcp", scope === "project" ? ctx.cwd : scope);
  const upsertResult = await updateServerConfig(path, name, { config, kind: "upsert" });
  ctx.ui.notify(
    `${upsertResult.updated ? "Updated" : "Saved"} MCP server ${name} ${scope}ly (${upsertResult.path}).`,
    "info",
  );
}

async function promptServerConfig(
  ctx: ExtensionCommandContext,
  transport: McpTransport,
  name: string,
  existingConfig?: McpServer,
): Promise<McpServer | undefined> {
  const placeholder = existingConfig
    ? JSON.stringify(existingConfig, null, 2)
    : buildConfigTemplate(transport);

  const config = await ctx.ui.custom<string>((tui, theme, keybindings, done) => {
    const frame = new Frame(theme);
    const input = new PlaceholderInput(tui, keybindings, theme, placeholder, "dim");
    const title = customText(theme.bold(`Configure ${name} MCP server`));

    input.onSubmit = done;
    input.onEscape = () => done("");
    input.focused = true;

    frame.addCustom(title);
    frame.addCustom(new Spacer());
    frame.addCustom(input);

    return {
      handleInput: (data: string) => input.handleInput(data),
      render: (width: number) => frame.render(width),
      invalidate: () => frame.invalidate(),
    };
  });

  if (!config) return;

  try {
    const parsed = JSON.parse(config) as Record<string, any>;
    parsed.transport = transport;
    const serverConfig = normalizeServerConfig(name, parsed);
    return serverConfig;
  } catch (error) {
    if (error instanceof Error) {
      ctx.ui.notify(error.message, "error");
    } else {
      ctx.ui.notify("Invalid MCP JSON config", "error");
    }
  }
}

function buildConfigTemplate(transport: McpTransport): string {
  const httpExample = {
    url: "https://mcp.example.com/",
    description: "This field is useful for telling agent when it should use an MCP",
    headers: {},
  };
  const stdioExample = {
    command: "npx",
    description: "This field is useful for telling agent when it should use an MCP",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    env: {},
  };
  const template = transport === "http" ? httpExample : stdioExample;

  return JSON.stringify(template, null, 2);
}
