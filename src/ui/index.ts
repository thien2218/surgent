import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import brandingExtension from "./branding.js";
import inputModeIndicatorExtension from "./input-mode-indicator.js";
import scrollToBottomExtension from "./scroll-to-bottom.js";

export default function uiExtensions(pi: ExtensionAPI) {
  brandingExtension(pi);
  inputModeIndicatorExtension(pi);
  scrollToBottomExtension(pi);
}
