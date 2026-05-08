import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import inputModeIndicatorExtension from "./input-mode-indicator.js";

export default async function uiExtensions(pi: ExtensionAPI) {
  await inputModeIndicatorExtension(pi);
}
