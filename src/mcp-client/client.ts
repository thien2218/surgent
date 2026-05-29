import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ResolvedMcpServerConfig } from "./types.js";

interface ManagedConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  configHash: string;
}

export class McpClientManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly CLIENT_INFO = {
    name: "surgent-mcp-client",
    version: "0.1.0",
  };

  async listTools(serverConfig: ResolvedMcpServerConfig) {
    const connection = await this.getConnection(serverConfig);
    return connection.client.listTools();
  }

  async callTool(serverConfig: ResolvedMcpServerConfig, params: CallToolRequest["params"]) {
    const connection = await this.getConnection(serverConfig);
    return connection.client.callTool(params);
  }

  async disposeAll(): Promise<void> {
    const activeConnections = Array.from(this.connections.values());
    this.connections.clear();
    await Promise.allSettled(
      activeConnections.map((connection) => this.disposeConnection(connection)),
    );
  }

  private async getConnection(serverConfig: ResolvedMcpServerConfig): Promise<ManagedConnection> {
    const cacheKey = serverConfig.name;
    const configHash = JSON.stringify(serverConfig);
    const existing = this.connections.get(cacheKey);

    if (existing && existing.configHash === configHash) {
      return existing;
    }

    if (existing) {
      await this.disposeConnection(existing);
      this.connections.delete(cacheKey);
    }

    const connection = await this.createConnection(serverConfig, configHash);
    this.connections.set(cacheKey, connection);
    return connection;
  }

  private async createConnection(
    serverConfig: ResolvedMcpServerConfig,
    configHash: string,
  ): Promise<ManagedConnection> {
    const client = new Client(this.CLIENT_INFO);
    const transport =
      serverConfig.transport === "stdio"
        ? new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            cwd: serverConfig.cwd,
            env: serverConfig.env,
          })
        : new StreamableHTTPClientTransport(new URL(serverConfig.url), {
            requestInit: serverConfig.headers ? { headers: serverConfig.headers } : undefined,
          });

    await client.connect(transport);

    return { client, transport, configHash };
  }

  private async disposeConnection(connection: ManagedConnection): Promise<void> {
    if (connection.transport instanceof StreamableHTTPClientTransport) {
      await Promise.allSettled([
        connection.transport.terminateSession(),
        connection.transport.close(),
      ]);
      return;
    }

    await connection.transport.close();
  }
}
