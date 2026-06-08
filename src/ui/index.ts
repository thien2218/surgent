import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import ModeIndicatorEditor from "./components/input-mode-indicator.js";
import { readFileSync } from "node:fs";

const PACKAGE_JSON_PATH = new URL("../../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
  name: string;
  version: string;
};

const APP_NAME = packageJson.name;
const APP_VERSION = packageJson.version;
const BASH_MODE_HOTKEY = Key.ctrlAlt("b");

export default function uiExtensions(pi: ExtensionAPI) {
  let activeEditor: ModeIndicatorEditor | undefined;

  pi.registerShortcut(BASH_MODE_HOTKEY, {
    description: "Cycle input mode (prompt / bash (included in context) / normal bash)",
    handler: () => activeEditor?.cycleMode(),
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => ({
      render: () => [
        `${theme.bold(theme.fg("accent", APP_NAME))}${theme.fg("dim", ` v${APP_VERSION} · built on top of pi v${PI_VERSION}`)}`,
      ],
      invalidate() {},
    }));

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeEditor = new ModeIndicatorEditor(tui, theme, keybindings, ctx.ui.theme);
      return activeEditor;
    });
  });
}
