import { writeFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "results-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ["safe", "blocked"].map((name) => ({
    name, inputSchema: { type: "object" },
    outputSchema: { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "blocked") await writeFile("blocked-executed", "unexpected");
  return { content: [{ type: "text", text: "fixture response" }], structuredContent: { count: 3 } };
});
await server.connect(new StdioServerTransport());
