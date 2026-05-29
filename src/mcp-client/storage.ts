import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getPiGlobalPath, getPiLocalPath } from "../utils.js";
import type {
  HttpMcpServerConfig,
  McpConfigScope,
  McpServerConfig,
  ResolvedMcpServerConfig,
  StdioMcpServerConfig,
} from "./types.js";

export const MCP_CONFIG_FILE = "mcp.json";
export const MCP_GLOBAL_CONFIG = getPiGlobalPath(MCP_CONFIG_FILE);

export async function readScopeConfig(
  cwd: string,
  scope: McpConfigScope,
): Promise<Record<string, McpServerConfig>> {
  const path = getScopeConfigPath(cwd, scope);
  return readConfigFile(path);
}

export async function upsertServerConfig(
  cwd: string,
  scope: McpConfigScope,
  name: string,
  serverConfig: McpServerConfig,
): Promise<{ path: string; replaced: boolean }> {
  const path = getScopeConfigPath(cwd, scope);
  const servers = await readConfigFile(path);
  const replaced = Object.hasOwn(servers, name);

  servers[name] = normalizeServerConfig(name, serverConfig);
  const sortedServers = Object.fromEntries(
    Object.entries(servers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, serverConfig]) => [name, serverConfig]),
  );

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ servers: sortedServers }, null, 2)}\n`, "utf8");
  return { path, replaced };
}

export async function loadResolvedConfigSet(cwd: string): Promise<ResolvedMcpServerConfig[]> {
  const localPath = getPiLocalPath(cwd, MCP_CONFIG_FILE);
  const [localServers, globalServers] = await Promise.all([
    readConfigFile(localPath),
    readConfigFile(MCP_GLOBAL_CONFIG),
  ]);

  const merged = new Map<string, ResolvedMcpServerConfig>();

  for (const [name, serverConfig] of Object.entries(localServers)) {
    merged.set(name, { ...serverConfig, name, scope: "local", sourcePath: localPath });
  }

  for (const [name, serverConfig] of Object.entries(globalServers)) {
    merged.set(name, { ...serverConfig, name, scope: "global", sourcePath: MCP_GLOBAL_CONFIG });
  }

  return Array.from(merged.values());
}

export async function resolveServerConfig(
  cwd: string,
  serverName: string,
): Promise<ResolvedMcpServerConfig | undefined> {
  const servers = await loadResolvedConfigSet(cwd);
  return servers.find((server) => server.name === serverName);
}

function getScopeConfigPath(cwd: string, scope: McpConfigScope): string {
  return scope === "local" ? getPiLocalPath(cwd, MCP_CONFIG_FILE) : MCP_GLOBAL_CONFIG;
}

async function readConfigFile(path: string): Promise<Record<string, McpServerConfig>> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in MCP config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Invalid MCP config: top-level JSON value must be an object.");
  }

  const rawServers = isPlainObject(parsed.servers) ? parsed.servers : parsed;
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, serverConfig] of Object.entries(rawServers)) {
    servers[name] = normalizeServerConfig(name, serverConfig);
  }

  return servers;
}

export function normalizeServerConfig(name: string, raw: unknown): McpServerConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid MCP server config for ${name}: expected an object.`);
  }

  const transport = getTransport(raw, name);
  const enabled = raw.enabled === undefined ? true : expectBoolean(raw.enabled, name, "enabled");
  const description =
    raw.description === undefined ? undefined : expectString(raw.description, name, "description");

  if (transport === "stdio") {
    const config: StdioMcpServerConfig = {
      transport: "stdio",
      command: expectString(raw.command, name, "command"),
      enabled,
    };

    if (description) {
      config.description = description;
    }
    if (raw.args !== undefined) {
      config.args = expectStringArray(raw.args, name, "args");
    }
    if (raw.cwd !== undefined) {
      config.cwd = expectString(raw.cwd, name, "cwd");
    }
    if (raw.env !== undefined) {
      config.env = expectStringRecord(raw.env, name, "env");
    }

    return config;
  }

  if (transport === "http") {
    const config: HttpMcpServerConfig = {
      transport: "http",
      url: expectString(raw.url, name, "url"),
      enabled,
    };

    if (description) {
      config.description = description;
    }
    if (raw.headers !== undefined) {
      config.headers = expectStringRecord(raw.headers, name, "headers");
    }

    return config;
  }

  throw new Error(`Invalid MCP server config for ${name}: transport must be "stdio" or "http".`);
}

function getTransport(raw: Record<string, unknown>, serverName: string): "stdio" | "http" {
  const declared = raw.transport ?? raw.type;

  if (declared === "stdio") {
    return "stdio";
  }
  if (declared === "http" || declared === "https") {
    return "http";
  }
  if (declared !== undefined) {
    throw new Error(
      `Invalid MCP server config for ${serverName}: transport/type must be "stdio", "http", or "https".`,
    );
  }
  if (typeof raw.command === "string") {
    return "stdio";
  }
  if (typeof raw.url === "string") {
    return "http";
  }

  throw new Error(
    `Invalid MCP server config for ${serverName}: include either command for stdio or url for http, or set transport explicitly.`,
  );
}

function expectBoolean(value: unknown, serverName: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid MCP server config for ${serverName}: ${field} must be a boolean.`);
  }
  return value;
}

function expectString(value: unknown, serverName: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid MCP server config for ${serverName}: ${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function expectStringArray(value: unknown, serverName: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Invalid MCP server config for ${serverName}: ${field} must be an array of strings.`,
    );
  }
  return value;
}

function expectStringRecord(
  value: unknown,
  serverName: string,
  field: string,
): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(
      `Invalid MCP server config for ${serverName}: ${field} must be an object of string values.`,
    );
  }

  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(
        `Invalid MCP server config for ${serverName}: ${field}.${key} must be a string.`,
      );
    }
    record[key] = item;
  }

  return record;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
