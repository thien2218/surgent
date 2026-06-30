import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mcpCommandHandler } from "./command.js";
import { McpClientManager } from "./client.js";
import { createMcpCallTool } from "./call-tool.js";
import { createMcpListToolsTool } from "./list-tools.js";

export default function mcpClientExtension(pi: ExtensionAPI) {
  const clientManager = new McpClientManager();

  pi.registerCommand("mcp", {
    description: "Manage MCP servers: add new server and toggle enabled state",
    handler: mcpCommandHandler,
  });

  pi.registerTool(createMcpCallTool(clientManager));
  pi.registerTool(createMcpListToolsTool(clientManager));

  pi.on("session_shutdown", async () => {
    await clientManager.disposeAll();
  });
}
