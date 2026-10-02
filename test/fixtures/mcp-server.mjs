import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "stdio-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "environment", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{
    type: "text",
    text: JSON.stringify({
      arguments: request.params.arguments,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      fixture: process.env.MCP_FIXTURE,
      pid: process.pid,
    }),
  }],
}));
await server.connect(new StdioServerTransport());
