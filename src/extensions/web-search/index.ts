import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerWebSearchTool from "./search.js";

export default async function webSearchExtension(pi: ExtensionAPI) {
  registerWebSearchTool(pi);
}
