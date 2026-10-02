import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ListToolsRequest,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { expect, it, onTestFinished, vi } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionWorkspace } from "../../helpers/permission.js";

async function startServer(
  listTools: (request: ListToolsRequest) => ListToolsResult,
  callTool: (request: CallToolRequest) => CallToolResult,
) {
  const servers = new Set<Server>();
  const http = createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const server = new Server({ name: "local-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
      servers.add(server);
      server.setRequestHandler(ListToolsRequestSchema, listTools);
      server.setRequestHandler(CallToolRequestSchema, callTool);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, JSON.parse(Buffer.concat(chunks).toString()));
    } catch (error) {
      if (!response.headersSent) response.writeHead(500).end(String(error));
      else response.destroy();
    }
  });
  onTestFinished(async () => {
    await Promise.allSettled([...servers].map((server) => server.close()));
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture TCP address");
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function setup(url: string) {
  const workspace = await makePermissionWorkspace("surgent-mcp-http-");
  onTestFinished(workspace.restore);
  vi.stubEnv("USERPROFILE", workspace.home);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  await writeFile(join(workspace.cwd, ".pi", "mcp.json"), JSON.stringify({
    fixture: { transport: "http", url, enabled: true },
  }));
  const recorded = recordExtension();
  mcpClient(recorded.api);
  const { ctx } = commandContext(workspace.cwd);
  onTestFinished(async () => { await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx); });
  return { recorded, ctx };
}

it("discovers every page including after an empty page and calls a later-page tool", async () => {
  const cursors: Array<string | undefined> = [];
  const calls: CallToolRequest["params"][] = [];
  const url = await startServer((request) => {
    cursors.push(request.params?.cursor);
    if (request.params?.cursor === "empty") return { tools: [], nextCursor: "last" };
    if (request.params?.cursor === "last") {
      return { tools: [{ name: "second", inputSchema: { type: "object", properties: { value: { type: "string" } } } }] };
    }
    return { tools: [{ name: "first", inputSchema: { type: "object" } }], nextCursor: "empty" };
  }, (request) => {
    calls.push(request.params);
    return { content: [{ type: "text", text: "later page reached" }] };
  });
  const { recorded, ctx } = await setup(url);

  const listing = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"] }, undefined, undefined, ctx);
  expect(listing.content[0]).toMatchObject({ text: expect.stringContaining("**first**") });
  expect(listing.content[0]).toMatchObject({ text: expect.stringContaining("**second**") });
  expect(cursors).toEqual([undefined, "empty", "last"]);

  const result = await recorded.tool("call_mcp_tool").execute("call", {
    server: "fixture", tool: "second", arguments: { value: "fixture input" },
  }, undefined, undefined, ctx);

  expect(calls).toEqual([{ name: "second", arguments: { value: "fixture input" } }]);
  expect(result.content).toEqual([{ type: "text", text: "later page reached" }]);
  expect(result.details).toMatchObject({ server: "fixture", transport: "http", remoteTool: "second" });
});
