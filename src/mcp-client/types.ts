export type McpConfigScope = "local" | "global";
export type McpTransport = "stdio" | "http";

export interface McpServerConfigBase {
  transport: McpTransport;
  enabled?: boolean;
  description?: string;
}

export interface StdioMcpServerConfig extends McpServerConfigBase {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface HttpMcpServerConfig extends McpServerConfigBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

export interface McpConfigFile {
  servers: Record<string, McpServerConfig>;
}

export type ResolvedMcpServerConfig = McpServerConfig & {
  name: string;
  scope: McpConfigScope;
  sourcePath: string;
};

export interface ResolvedMcpConfigSet {
  localPath: string;
  globalPath: string;
  servers: ResolvedMcpServerConfig[];
}

export interface McpCallToolDetails {
  server: string;
  transport: McpTransport;
  scope: McpConfigScope;
  remoteTool: string;
  contentTypes: string[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
