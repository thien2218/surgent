import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webLoginCommand from "./web-login/index.js";
import webFetchTool from "./web-fetch/index.js";
import { getArgumentCompletions } from "./web-login/helpers.js";
import webSearchTool from "./web-search/index.js";

export default function webAuthExtension(pi: ExtensionAPI) {
  pi.registerCommand("web-login", {
    description: "Configure API keys for authenticated web providers",
    getArgumentCompletions,
    handler: webLoginCommand,
  });
  pi.registerTool(webFetchTool);
  pi.registerTool(webSearchTool);
}
