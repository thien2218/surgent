export type McpTransport = "stdio" | "http";

interface McpServerBase {
  transport: McpTransport;
  enabled?: boolean;
  description?: string;
}

export interface StdioMcpServer extends McpServerBase {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface HttpMcpServer extends McpServerBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServer = StdioMcpServer | HttpMcpServer;

export type ResolvedMcpServer = McpServer & {
  name: string;
  scope: "project" | "global";
  sourcePath: string;
};

export interface McpToolCallDetails {
  server: string;
  transport: McpTransport;
  remoteTool: string;
  isError?: boolean;
}
