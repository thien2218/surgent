import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerWebFetchTool from "./web-fetch/index.js";
import webLoginCommand from "./web-login/index.js";
import registerWebSearchTool from "./web-search/index.js";

export default function webAuthExtension(pi: ExtensionAPI) {
  webLoginCommand(pi);
  registerWebFetchTool(pi);
  registerWebSearchTool(pi);
}
