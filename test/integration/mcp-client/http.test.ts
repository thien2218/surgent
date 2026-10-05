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
import { expect, it, onTestFinished } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

async function startServer(
  listTools: (request: ListToolsRequest) => ListToolsResult,
  callTool: (request: CallToolRequest) => CallToolResult,
) {
  const servers = new Set<Server>();
  const requests: Array<{ method: string; authorization: string | undefined }> = [];
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
      const message = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ method: message.method, authorization: request.headers.authorization });
      await transport.handleRequest(request, response, message);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500).end(String(error));
      else response.destroy();
    }
  });
  onTestFinished(async () => {
    await Promise.allSettled([...servers].map((server) => server.close()));
    if (!http.listening) return;
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture TCP address");
  return { url: `http://127.0.0.1:${address.port}/mcp`, requests };
}

async function setup(url: string, headers?: Record<string, string>) {
  const workspace = await createWorkspace({ prefix: "surgent-mcp-http-" });
  await writeFile(join(workspace.cwd, ".pi", "mcp.json"), JSON.stringify({
    fixture: { transport: "http", url, headers, enabled: true },
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
  const { url } = await startServer((request) => {
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

it("sends configured headers across the HTTP handshake and tool requests", async () => {
  const { url, requests } = await startServer(() => ({
    tools: [{ name: "echo", inputSchema: { type: "object" } }],
  }), () => ({ content: [{ type: "text", text: "authenticated fixture" }] }));
  const { recorded, ctx } = await setup(url, { Authorization: "Bearer fake-token" });

  const result = await recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "echo" }, undefined, undefined, ctx);

  expect(result.content).toEqual([{ type: "text", text: "authenticated fixture" }]);
  expect(requests.map((request) => request.method)).toEqual(expect.arrayContaining(["initialize", "tools/list", "tools/call"]));
  expect(requests.every((request) => request.authorization === "Bearer fake-token")).toBe(true);
});

it("reports an MCP protocol failure on a later discovery page instead of presenting an incomplete catalog", async () => {
  const { url } = await startServer((request) => {
    if (request.params?.cursor) throw new Error("fixture page unavailable");
    return { tools: [{ name: "incomplete", inputSchema: { type: "object" } }], nextCursor: "broken" };
  }, () => ({ content: [] }));
  const { recorded, ctx } = await setup(url);

  const result = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"] }, undefined, undefined, ctx);

  expect(result.content[0]).toMatchObject({ text: expect.stringContaining("fixture page unavailable") });
  expect(result.content[0]).toMatchObject({ text: expect.not.stringContaining("**incomplete**") });
});
