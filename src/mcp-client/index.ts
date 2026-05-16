import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerMcpConfigCommand from "./command.js";
import { McpClientManager } from "./client.js";
import registerMcpCallTool from "./tool.js";

export default function mcpClientExtension(pi: ExtensionAPI) {
	const clientManager = new McpClientManager();

	registerMcpConfigCommand(pi);
	registerMcpCallTool(pi, clientManager);

	pi.on("session_shutdown", async () => {
		await clientManager.disposeAll();
	});
}
