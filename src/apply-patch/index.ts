import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyPatch } from "./tool.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(applyPatch);
}
