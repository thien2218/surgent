import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Spacer } from "@earendil-works/pi-tui";
import {
  loadMcpConfigSet,
  normalizeServerConfig,
  readConfigFile,
  upsertServerConfig,
} from "./storage.js";
import type { McpServerConfig, McpTransport, ResolvedMcpServerConfig } from "./types.js";
import { customText, getPiPath, tokenizeArgs } from "../utils.js";
import { Frame } from "../ui/components/frame.js";
import { PlaceholderInput } from "../ui/components/placeholder-input.js";
import { ScopedInput } from "../ui/components/scoped-input.js";

const ACTIONS = ["save", "show"] as const;
type McpCommandAction = (typeof ACTIONS)[number];

export async function mcpConfigCommandHandler(args: string, ctx: ExtensionCommandContext) {
  const [actionToken, argToken] = tokenizeArgs(args);
  const action =
    actionToken && ACTIONS.includes(actionToken as McpCommandAction) ? actionToken : undefined;

  if (actionToken && !action) {
    ctx.ui.notify(
      `Unknown MCP action "${actionToken}". Supported actions: ${ACTIONS.join(", ")}.`,
      "error",
    );
    return;
  }

  const selectedAction = !ctx.hasUI ? "show" : (action ?? (await selectAction(ctx)));

  if (!selectedAction) {
    return;
  }
  if (selectedAction === "save") {
    await handleSaveFlow(ctx);
    return;
  }
  await showConfiguredMcpJson(ctx, argToken);
}

async function selectAction(ctx: ExtensionCommandContext): Promise<McpCommandAction | undefined> {
  const selected = await ctx.ui.select("MCP configuration", [
    "Save MCP server",
    "Show configured MCPs",
  ]);

  if (!selected) {
    return undefined;
  }

  const token = selected.split(" ")[0]!.toLowerCase() as McpCommandAction;
  return token;
}

async function handleSaveFlow(ctx: ExtensionCommandContext): Promise<void> {
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
    if (!confirmed) {
      return;
    }
  }

  const transportType = await ctx.ui.select("Server type", ["Remote", "Local"]);
  const transport = transportType === "Remote" ? "http" : "stdio";

  const serverConfig = await promptServerConfigJson(ctx, transport, name, configuredServers[name]);
  if (!serverConfig) {
    return;
  }

  const path = getPiPath("mcp", scope === "project" ? ctx.cwd : scope);
  const upsertResult = await upsertServerConfig(path, name, serverConfig);
  ctx.ui.notify(
    `${upsertResult.replaced ? "Updated" : "Saved"} MCP server ${name} ${scope}ly (${upsertResult.path}).`,
    "info",
  );
}

async function showConfiguredMcpJson(
  ctx: ExtensionCommandContext,
  configuredMcpName?: string,
): Promise<void> {
  const servers = await loadMcpConfigSet(ctx.cwd);
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
    JSON.stringify(stripResolvedMetadata(targetServer), null, 2),
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

function formatServerOption(server: ResolvedMcpServerConfig): string {
  return `${server.name} [${server.scope}]`;
}

function stripResolvedMetadata(server: ResolvedMcpServerConfig): McpServerConfig {
  const { name: _name, scope: _scope, sourcePath: _sourcePath, ...config } = server;
  return config;
}

async function promptServerConfigJson(
  ctx: ExtensionCommandContext,
  transport: McpTransport,
  name: string,
  existingConfig?: McpServerConfig,
): Promise<McpServerConfig | undefined> {
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
  const template =
    transport === "http"
      ? {
          url: "https://mcp.example.com/",
          description: "This field is useful for telling agent when it should use an MCP",
          headers: {},
        }
      : {
          command: "npx",
          description: "This field is useful for telling agent when it should use an MCP",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
          env: {},
        };

  return JSON.stringify(template, null, 2);
}
