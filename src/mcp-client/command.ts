import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  loadResolvedConfigSet,
  MCP_CONFIG_FILE,
  MCP_GLOBAL_CONFIG,
  normalizeServerConfig,
  readScopeConfig,
  upsertServerConfig,
} from "./storage.js";
import type { McpConfigScope, McpServerConfig, ResolvedMcpServerConfig } from "./types.js";
import { getPiLocalPath, tokenizeArgs } from "../utils.js";
import { Frame } from "../ui/components/frame.js";
import { PlaceholderInput } from "../ui/components/placeholder-input.js";

const ACTIONS = ["save", "list", "show"] as const;
type McpCommandAction = (typeof ACTIONS)[number];

export async function mcpConfigCommandHandler(args: string, ctx: ExtensionCommandContext) {
  const [actionToken, argToken] = tokenizeArgs(args);
  const action =
    actionToken && ACTIONS.includes(actionToken as McpCommandAction) ? actionToken : undefined;

  if (actionToken && !action) {
    ctx.ui.notify(
      `Unknown mcp action "${actionToken}". Supported actions: ${ACTIONS.join(", ")}.`,
      "error",
    );
    return;
  }

  const selectedAction = !ctx.hasUI ? "show" : (action ?? (await selectAction(ctx)));

  if (!selectedAction) {
    return;
  }
  if (selectedAction === "save") {
    await handleSaveFlow(ctx, argToken);
    return;
  }
  if (selectedAction === "list") {
    await showConfiguredScopes(ctx, argToken);
    return;
  }

  await showConfiguredMcpJson(ctx, argToken);
}

async function selectAction(ctx: ExtensionCommandContext): Promise<McpCommandAction | undefined> {
  const selected = await ctx.ui.select("MCP configuration", [
    "Save MCP server",
    "List configured MCP servers",
    "Show configured MCP",
  ]);

  if (!selected) {
    return undefined;
  }

  const token = selected.split(" ")[0]! as McpCommandAction;
  return token;
}

async function handleSaveFlow(ctx: ExtensionCommandContext, scopeToken?: string): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("mcp save requires an interactive UI.", "error");
    return;
  }

  const scope = await pickScope(ctx, scopeToken);
  if (!scope) {
    return;
  }

  const name = await ctx.ui.input("MCP server name");
  if (!name?.trim()) {
    return;
  }

  const existingScopeServers = await readScopeConfig(ctx.cwd, scope);
  const hasExisting = Object.hasOwn(existingScopeServers, name);

  if (hasExisting) {
    const confirmed = await ctx.ui.confirm(
      `Replace ${name} MCP`,
      `${name} MCP already exists ${scope}ly. Do you want to replace it?`,
    );
    if (!confirmed) {
      return;
    }
  }

  const serverConfig = await promptServerConfigJson(ctx, name, existingScopeServers[name]);
  if (!serverConfig) {
    return;
  }

  const result = await upsertServerConfig(ctx.cwd, scope, name, serverConfig);
  ctx.ui.notify(
    `${result.replaced ? "Updated" : "Saved"} MCP server ${name} in ${scope} scope (${result.path}).`,
    "info",
  );
}

async function showConfiguredMcpJson(
  ctx: ExtensionCommandContext,
  configuredMcpName?: string,
): Promise<void> {
  const servers = await loadResolvedConfigSet(ctx.cwd);
  const targetServer = configuredMcpName
    ? servers.find((server) => server.name === configuredMcpName)
    : await selectConfiguredMcp(ctx, servers);

  if (!targetServer) {
    const message = configuredMcpName
      ? `No MCP server named ${configuredMcpName} is configured.`
      : "No MCP servers configured.";
    ctx.ui.notify(message, "warning");
    return;
  }

  await ctx.ui.editor(
    `Configured MCP JSON: ${targetServer.name}`,
    `${JSON.stringify(stripResolvedMetadata(targetServer), null, 2)}\n`,
  );
}

async function selectConfiguredMcp(
  ctx: ExtensionCommandContext,
  servers: ResolvedMcpServerConfig[],
): Promise<ResolvedMcpServerConfig | undefined> {
  if (servers.length === 0) {
    return undefined;
  }

  if (!ctx.hasUI) {
    return servers[0];
  }

  const options = servers.map((server) => formatServerOption(server));
  const selected = await ctx.ui.select("Choose configured MCP", options);
  if (!selected) {
    return undefined;
  }

  return servers.find((server) => formatServerOption(server) === selected);
}

async function showConfiguredScopes(
  ctx: ExtensionCommandContext,
  filterName?: string,
): Promise<void> {
  const [globalServers, localServers] = await Promise.all([
    readScopeConfig(ctx.cwd, "local"),
    readScopeConfig(ctx.cwd, "global"),
  ]);

  const localEntries = getScopeEntries(localServers, "local", filterName);
  const globalEntries = getScopeEntries(globalServers, "global", filterName);

  if (localEntries.length === 0 && globalEntries.length === 0) {
    const message = filterName
      ? `No MCP server named ${filterName} is configured.`
      : `No MCP servers configured.`;
    ctx.ui.notify(message, "warning");
    return;
  }

  const lines = [
    `Local config: ${getPiLocalPath(ctx.cwd, MCP_CONFIG_FILE)}`,
    ...formatScopeSection("Local MCPs", localEntries),
    `Global config: ${MCP_GLOBAL_CONFIG}`,
    ...formatScopeSection("Global MCPs", globalEntries),
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

function formatServerStatus(server: ResolvedMcpServerConfig): string {
  const status = server.enabled === false ? "disabled" : "enabled";
  const summary =
    server.transport === "stdio"
      ? `${server.command}${server.args?.length ? ` ${server.args.join(" ")}` : ""}`
      : server.url;

  return `${server.name} [${server.scope}] ${server.transport} ${status} -> ${summary}`;
}

function formatServerOption(server: ResolvedMcpServerConfig): string {
  return `${server.name} [${server.scope}]`;
}

function stripResolvedMetadata(server: ResolvedMcpServerConfig): McpServerConfig {
  const { name: _name, scope: _scope, sourcePath: _sourcePath, ...config } = server;
  return config;
}

function getScopeEntries(
  servers: Record<string, McpServerConfig>,
  scope: McpConfigScope,
  filterName?: string,
): ResolvedMcpServerConfig[] {
  return Object.entries(servers)
    .filter(([name]) => !filterName || name === filterName)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, server]) => ({
      ...server,
      name,
      scope,
      sourcePath: scope,
    }));
}

function formatScopeSection(title: string, servers: ResolvedMcpServerConfig[]): string[] {
  if (servers.length === 0) {
    return [`${title}: none`];
  }

  return [`${title}:`, ...servers.map((server) => `- ${formatServerStatus(server)}`)];
}

async function pickScope(
  ctx: ExtensionCommandContext,
  scopeToken?: string,
): Promise<McpConfigScope | undefined> {
  if (scopeToken === "local" || scopeToken === "global") {
    return scopeToken;
  }

  const selected = await ctx.ui.select("Save MCP server config to", ["Local project", "Global"]);

  if (!selected) {
    return undefined;
  }

  return selected.startsWith("Local project") ? "local" : "global";
}

async function promptServerConfigJson(
  ctx: ExtensionCommandContext,
  name: string,
  existingConfig?: McpServerConfig,
): Promise<McpServerConfig | undefined> {
  const value = existingConfig ? JSON.stringify(existingConfig, null, 2) : buildConfigTemplate();

  const config = await ctx.ui.custom<string>((tui, theme, keybindings, done) => {
    const frame = new Frame(theme);
    const input = new PlaceholderInput(tui, keybindings, theme, value, "dim");
    const title = new Text(theme.bold(`Configure ${name} MCP server`));

    input.onSubmit = done;
    input.onEscape = () => done("");
    frame.addCustom(title);
    frame.addCustom(input);

    return {
      get focused() {
        return input.focused;
      },
      set focused(v: boolean) {
        input.focused = v;
      },
      handleInput: (data: string) => input.handleInput(data),
      render: (width: number) => frame.render(width),
      invalidate: () => frame.invalidate(),
    };
  });

  if (!config) return;

  try {
    const parsed = JSON.parse(config) as unknown;
    const serverConfig = normalizeServerConfig(name, parsed);
    return serverConfig;
  } catch {
    ctx.ui.notify("Invalid MCP JSON config", "error");
  }
}

function buildConfigTemplate(): string {
  return JSON.stringify(
    {
      command: "npx",
      description: "This field is useful for telling agent when it should use an MCP",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: {},
    },
    null,
    2,
  );
}
