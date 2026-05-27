import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { brandingSessionStartHandler } from "./branding.js";
import registerInputModeIndicator from "./components/input-mode-indicator.js";

export default function uiExtensions(pi: ExtensionAPI) {
  pi.on("session_start", brandingSessionStartHandler);
  registerInputModeIndicator(pi);
}
