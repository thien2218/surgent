import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import brandingExtension from "./branding.js";
import inputModeIndicatorExtension from "./input-mode-indicator.js";

export default async function uiExtensions(pi: ExtensionAPI) {
  await brandingExtension(pi);
  await inputModeIndicatorExtension(pi);
}
