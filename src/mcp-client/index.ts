import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mcpConfigCommandHandler } from "./command.js";
import { McpClientManager } from "./client.js";
import { createMcpCallTool } from "./tool.js";
import { createMcpListToolsTool } from "./list-tools.js";

export default function mcpClientExtension(pi: ExtensionAPI) {
  const clientManager = new McpClientManager();

  pi.registerCommand("mcp", {
    description: "Save MCP server configs, list local/global configs, and show configured MCP JSON",
    handler: mcpConfigCommandHandler,
  });

  pi.registerTool(createMcpCallTool(clientManager));
  pi.registerTool(createMcpListToolsTool(clientManager));

  pi.on("session_shutdown", async () => {
    await clientManager.disposeAll();
  });
}
