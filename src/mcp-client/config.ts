import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getPiGlobalPath, getPiLocalPath } from "../utils.js";
import type {
  HttpMcpServerConfig,
  McpConfigFile,
  McpConfigScope,
  McpServerConfig,
  ResolvedMcpConfigSet,
  ResolvedMcpServerConfig,
  StdioMcpServerConfig,
} from "./types.js";

export const LOCAL_CONFIG_FILE = "mcp.json";

export async function readScopeConfig(cwd: string, scope: McpConfigScope): Promise<McpConfigFile> {
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
  const config = await readConfigFile(path);
  const replaced = Object.hasOwn(config.servers, name);
  config.servers[name] = normalizeServerConfig(name, serverConfig, path);
  await writeConfigFile(path, config);
  return { path, replaced };
}

export async function loadResolvedConfigSet(cwd: string): Promise<ResolvedMcpConfigSet> {
  const globalPath = getPiGlobalPath(LOCAL_CONFIG_FILE);
  const localPath = getPiLocalPath(cwd, LOCAL_CONFIG_FILE);
  const [globalConfig, localConfig] = await Promise.all([
    readConfigFile(globalPath),
    readConfigFile(localPath),
  ]);

  const merged = new Map<string, ResolvedMcpServerConfig>();

  for (const [name, serverConfig] of Object.entries(globalConfig.servers)) {
    merged.set(name, { ...serverConfig, name, scope: "global", sourcePath: globalPath });
  }

  for (const [name, serverConfig] of Object.entries(localConfig.servers)) {
    merged.set(name, { ...serverConfig, name, scope: "local", sourcePath: localPath });
  }

  return {
    localPath,
    globalPath,
    servers: Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function resolveServerConfig(
  cwd: string,
  serverName: string,
): Promise<ResolvedMcpServerConfig | undefined> {
  const { servers } = await loadResolvedConfigSet(cwd);
  return servers.find((server) => server.name === serverName);
}

function getScopeConfigPath(cwd: string, scope: McpConfigScope): string {
  return scope === "local"
    ? getPiLocalPath(cwd, LOCAL_CONFIG_FILE)
    : getPiGlobalPath(LOCAL_CONFIG_FILE);
}

async function readConfigFile(path: string): Promise<McpConfigFile> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return { servers: {} };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in MCP config ${path}: ${formatErrorMessage(error)}`);
  }

  return normalizeConfigFile(parsed, path);
}

async function writeConfigFile(path: string, config: McpConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sortedServers = Object.fromEntries(
    Object.entries(config.servers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, serverConfig]) => [name, sortServerConfig(serverConfig)]),
  );
  await writeFile(path, `${JSON.stringify({ servers: sortedServers }, null, 2)}\n`, "utf8");
}

function normalizeConfigFile(raw: unknown, path: string): McpConfigFile {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid MCP config ${path}: top-level JSON value must be an object.`);
  }

  const rawServers = isPlainObject(raw.servers) ? raw.servers : raw;
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, serverConfig] of Object.entries(rawServers)) {
    servers[name] = normalizeServerConfig(name, serverConfig, path);
  }

  return { servers };
}

function normalizeServerConfig(name: string, raw: unknown, path: string): McpServerConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid MCP server config for ${name} in ${path}: expected an object.`);
  }

  const transport = getTransport(raw, name, path);
  const enabled =
    raw.enabled === undefined ? true : expectBoolean(raw.enabled, name, path, "enabled");
  const description =
    raw.description === undefined
      ? undefined
      : expectString(raw.description, name, path, "description");

  if (transport === "stdio") {
    const config: StdioMcpServerConfig = {
      transport: "stdio",
      command: expectString(raw.command, name, path, "command"),
      enabled,
    };

    if (description) {
      config.description = description;
    }
    if (raw.args !== undefined) {
      config.args = expectStringArray(raw.args, name, path, "args");
    }
    if (raw.cwd !== undefined) {
      config.cwd = expectString(raw.cwd, name, path, "cwd");
    }
    if (raw.env !== undefined) {
      config.env = expectStringRecord(raw.env, name, path, "env");
    }

    return config;
  }

  if (transport === "http") {
    const config: HttpMcpServerConfig = {
      transport: "http",
      url: expectString(raw.url, name, path, "url"),
      enabled,
    };

    if (description) {
      config.description = description;
    }
    if (raw.headers !== undefined) {
      config.headers = expectStringRecord(raw.headers, name, path, "headers");
    }

    return config;
  }

  throw new Error(
    `Invalid MCP server config for ${name} in ${path}: transport must be "stdio" or "http".`,
  );
}

function getTransport(
  raw: Record<string, unknown>,
  serverName: string,
  path: string,
): "stdio" | "http" {
  const declared = raw.transport ?? raw.type;

  if (declared === "stdio") {
    return "stdio";
  }
  if (declared === "http" || declared === "https") {
    return "http";
  }
  if (declared !== undefined) {
    throw new Error(
      `Invalid MCP server config for ${serverName} in ${path}: transport/type must be "stdio", "http", or "https".`,
    );
  }
  if (typeof raw.command === "string") {
    return "stdio";
  }
  if (typeof raw.url === "string") {
    return "http";
  }

  throw new Error(
    `Invalid MCP server config for ${serverName} in ${path}: include either command for stdio or url for http, or set transport explicitly.`,
  );
}

function expectBoolean(value: unknown, serverName: string, path: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(
      `Invalid MCP server config for ${serverName} in ${path}: ${field} must be a boolean.`,
    );
  }
  return value;
}

function expectString(value: unknown, serverName: string, path: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid MCP server config for ${serverName} in ${path}: ${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function expectStringArray(
  value: unknown,
  serverName: string,
  path: string,
  field: string,
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Invalid MCP server config for ${serverName} in ${path}: ${field} must be an array of strings.`,
    );
  }
  return value;
}

function expectStringRecord(
  value: unknown,
  serverName: string,
  path: string,
  field: string,
): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(
      `Invalid MCP server config for ${serverName} in ${path}: ${field} must be an object of string values.`,
    );
  }

  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(
        `Invalid MCP server config for ${serverName} in ${path}: ${field}.${key} must be a string.`,
      );
    }
    record[key] = item;
  }

  return record;
}

function sortServerConfig(serverConfig: McpServerConfig): McpServerConfig {
  if (serverConfig.transport === "stdio") {
    return {
      ...serverConfig,
      ...(serverConfig.env ? { env: sortRecord(serverConfig.env) } : {}),
    };
  }

  return {
    ...serverConfig,
    ...(serverConfig.headers ? { headers: sortRecord(serverConfig.headers) } : {}),
  };
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
