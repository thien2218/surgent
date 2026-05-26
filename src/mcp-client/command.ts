import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  loadResolvedConfigSet,
  MCP_CONFIG_FILE,
  readScopeConfig,
  upsertServerConfig,
} from "./config.js";
import type { McpConfigScope, McpServerConfig, ResolvedMcpServerConfig } from "./types.js";
import { getPiGlobalPath, getPiLocalPath, tokenizeArgs } from "../utils.js";

const ACTIONS = ["save", "list", "show"] as const;
type McpCommandAction = (typeof ACTIONS)[number];

export async function mcpConfigCommandHandler(args: string, ctx: ExtensionCommandContext) {
  const [actionToken, argToken] = tokenizeArgs(args);
  const action = actionToken && isAction(actionToken) ? actionToken : undefined;

  if (actionToken && !action) {
    ctx.ui.notify(
      `Unknown mcp-config action "${actionToken}". Supported actions: ${ACTIONS.join(", ")}.`,
      "error",
    );
    return;
  }

  const selectedAction = action ?? (await selectAction(ctx));
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
  if (!ctx.hasUI) {
    return "show";
  }

  const selected = await ctx.ui.select("MCP configuration", [
    "Save MCP server",
    "List configured MCP servers",
    "Show configured MCP",
  ]);

  if (!selected) {
    return undefined;
  }
  if (selected === "Save MCP server") {
    return "save";
  }
  if (selected === "List configured MCP servers") {
    return "list";
  }

  return "show";
}

async function handleSaveFlow(ctx: ExtensionCommandContext, scopeToken?: string): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("mcp-config save requires an interactive UI.", "error");
    return;
  }

  const scope = await pickScope(ctx, scopeToken);
  if (!scope) {
    return;
  }

  const name = await ctx.ui.input("MCP server name", "Name used inside mcp_call_tool");
  if (!name?.trim()) {
    return;
  }

  const existingScopeConfig = await readScopeConfig(ctx.cwd, scope);
  const hasExisting = Object.hasOwn(existingScopeConfig.servers, name);
  if (hasExisting) {
    const confirmed = await ctx.ui.confirm(
      `Replace ${name}`,
      `An MCP server named ${name} already exists in ${scope} scope. Replace it?`,
    );
    if (!confirmed) {
      return;
    }
  }

  const serverConfig = await promptServerConfigJson(
    ctx,
    scope,
    name,
    existingScopeConfig.servers[name],
  );
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
  const configSet = await loadResolvedConfigSet(ctx.cwd);
  const targetServer = configuredMcpName
    ? configSet.servers.find((server) => server.name === configuredMcpName)
    : await selectConfiguredMcp(ctx, configSet.servers);

  if (!targetServer) {
    const message = configuredMcpName
      ? `No MCP server named ${configuredMcpName} is configured.`
      : `No MCP servers configured. Local file: ${configSet.localPath}. Global file: ${configSet.globalPath}.`;
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
  const [localConfig, globalConfig] = await Promise.all([
    readScopeConfig(ctx.cwd, "local"),
    readScopeConfig(ctx.cwd, "global"),
  ]);

  const localEntries = getScopeEntries(localConfig.servers, "local", filterName);
  const globalEntries = getScopeEntries(globalConfig.servers, "global", filterName);

  if (localEntries.length === 0 && globalEntries.length === 0) {
    const message = filterName
      ? `No MCP server named ${filterName} is configured in local or global scope.`
      : `No MCP servers configured in local or global scope.`;
    ctx.ui.notify(message, "warning");
    return;
  }

  const lines = [
    `Local config: ${getPiLocalPath(ctx.cwd, MCP_CONFIG_FILE)}`,
    ...formatScopeSection("Local MCPs", localEntries),
    `Global config: ${getPiGlobalPath(MCP_CONFIG_FILE)}`,
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

  const selected = await ctx.ui.select("Save MCP server config to", [
    "Project-local (.pi/mcp.json)",
    "Global (~/.pi/agent/mcp.json)",
  ]);

  if (!selected) {
    return undefined;
  }

  return selected.startsWith("Project-local") ? "local" : "global";
}

async function promptServerConfigJson(
  ctx: ExtensionCommandContext,
  scope: McpConfigScope,
  name: string,
  existingConfig?: McpServerConfig,
): Promise<McpServerConfig | undefined> {
  let currentValue = existingConfig
    ? JSON.stringify(existingConfig, null, 2)
    : buildConfigTemplate();

  while (true) {
    const raw = await ctx.ui.editor(`Paste MCP JSON config for ${name}`, `${currentValue}\n`);
    if (raw === undefined) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const serverConfig = normalizePastedServerConfig(name, parsed, scope);
      return serverConfig;
    } catch (error) {
      currentValue = raw;
      ctx.ui.notify(formatErrorMessage(error), "error");
    }
  }
}

function isAction(value: string): value is McpCommandAction {
  return ACTIONS.includes(value as McpCommandAction);
}

function normalizePastedServerConfig(
  name: string,
  value: unknown,
  _scope: McpConfigScope,
): McpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid MCP JSON for ${name}: expected a JSON object.`);
  }

  const record = { ...(value as Record<string, unknown>) };
  if (typeof record.url === "string") {
    try {
      new URL(record.url);
    } catch {
      throw new Error(`Invalid MCP JSON for ${name}: url must be a valid absolute URL.`);
    }
  }

  if (record.transport === undefined && typeof record.type !== "string") {
    if (typeof record.command === "string") {
      record.transport = "stdio";
    } else if (typeof record.url === "string") {
      record.transport = "http";
    }
  }

  validateRecordStrings(name, record.env, "env");
  validateRecordStrings(name, record.headers, "headers");
  validateStringArray(name, record.args, "args");

  if (record.transport === "stdio") {
    if (typeof record.command !== "string" || record.command.trim().length === 0) {
      throw new Error(`Invalid MCP JSON for ${name}: stdio configs require a non-empty command.`);
    }

    const config: McpServerConfig = {
      transport: "stdio",
      command: record.command.trim(),
      ...(typeof record.description === "string" && record.description.trim().length > 0
        ? { description: record.description.trim() }
        : {}),
      ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
      ...(Array.isArray(record.args) ? { args: record.args as string[] } : {}),
      ...(typeof record.cwd === "string" && record.cwd.trim().length > 0
        ? { cwd: record.cwd.trim() }
        : {}),
      ...(record.env && typeof record.env === "object" && !Array.isArray(record.env)
        ? { env: record.env as Record<string, string> }
        : {}),
    };

    return config;
  }

  if (record.transport === "http" || record.transport === "https" || record.type === "http") {
    if (typeof record.url !== "string" || record.url.trim().length === 0) {
      throw new Error(`Invalid MCP JSON for ${name}: http configs require a non-empty url.`);
    }

    const config: McpServerConfig = {
      transport: "http",
      url: record.url.trim(),
      ...(typeof record.description === "string" && record.description.trim().length > 0
        ? { description: record.description.trim() }
        : {}),
      ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
      ...(record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)
        ? { headers: record.headers as Record<string, string> }
        : {}),
    };

    return config;
  }

  throw new Error(
    `Invalid MCP JSON for ${name}: include either command for stdio or url for http, or set transport/type explicitly.`,
  );
}

function validateRecordStrings(name: string, value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid MCP JSON for ${name}: ${field} must be an object of string values.`);
  }

  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`Invalid MCP JSON for ${name}: ${field}.${key} must be a string.`);
    }
  }
}

function validateStringArray(name: string, value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid MCP JSON for ${name}: ${field} must be an array of strings.`);
  }
}

function buildConfigTemplate(): string {
  return JSON.stringify(
    {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: {},
    },
    null,
    2,
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
