export type McpTransport = "stdio" | "http";
export type McpConfigScope = "project" | "global";

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

export type ResolvedMcpServerConfig = McpServerConfig & {
  name: string;
  scope: McpConfigScope;
  sourcePath: string;
};

export interface McpCallToolDetails {
  server: string;
  transport: McpTransport;
  remoteTool: string;
  isError?: boolean;
}
