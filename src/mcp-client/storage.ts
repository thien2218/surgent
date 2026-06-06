import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getPiPath, isMissingFileError } from "../utils.js";
import type {
  HttpMcpServerConfig,
  McpServerConfig,
  ResolvedMcpServerConfig,
  StdioMcpServerConfig,
} from "./types.js";

export async function upsertServerConfig(
  path: string,
  name: string,
  serverConfig: McpServerConfig,
): Promise<{ path: string; replaced: boolean }> {
  const mcpServers = await readConfigFile(path);
  const replaced = Object.hasOwn(mcpServers, name);

  mcpServers[name] = normalizeServerConfig(name, serverConfig);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`, "utf8");
  return { path, replaced };
}

export async function loadResolvedConfigSet(cwd: string): Promise<ResolvedMcpServerConfig[]> {
  const localPath = getPiPath("mcp", cwd);
  const merged = new Map<string, ResolvedMcpServerConfig>();
  const [localServers, globalServers] = await Promise.all([
    readConfigFile(localPath),
    readConfigFile(getPiPath("mcp")),
  ]);

  for (const [name, serverConfig] of Object.entries(localServers)) {
    merged.set(name, { ...serverConfig, name, scope: "project", sourcePath: localPath });
  }
  for (const [name, serverConfig] of Object.entries(globalServers)) {
    merged.set(name, { ...serverConfig, name, scope: "global", sourcePath: getPiPath("mcp") });
  }

  return Array.from(merged.values());
}

export async function resolveServerConfig(
  cwd: string,
  serverName: string,
): Promise<ResolvedMcpServerConfig | undefined> {
  const mcpServers = await loadResolvedConfigSet(cwd);
  return mcpServers.find((server) => server.name === serverName);
}

export async function readConfigFile(path: string): Promise<Record<string, McpServerConfig>> {
  const mcpServers: Record<string, McpServerConfig> = {};
  let raw: string;
  let parsed: unknown;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in MCP config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
    throw new Error("Invalid MCP config: top-level JSON value must be an object.");
  }

  for (const [name, serverConfig] of Object.entries(parsed.mcpServers)) {
    mcpServers[name] = normalizeServerConfig(name, serverConfig);
  }

  return mcpServers;
}

export function normalizeServerConfig(name: string, raw: unknown): McpServerConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`Invalid MCP server config for ${name}: expected an object.`);
  }

  const transport = getTransport(raw, name);
  const enabled = raw.enabled === undefined ? false : expectBoolean(raw.enabled, name, "enabled");
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
