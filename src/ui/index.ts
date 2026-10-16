import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import ModeIndicatorEditor from "./components/input-mode-indicator.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

const PACKAGE_JSON_PATH = new URL("../../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
  name: string;
  version: string;
};

const APP_NAME = packageJson.name;
const APP_VERSION = packageJson.version;
const BASH_MODE_HOTKEY = Key.ctrlAlt("b");
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function (pi: ExtensionAPI) {
  let activeEditor: ModeIndicatorEditor | undefined;
  let titleTimer: ReturnType<typeof setInterval> | undefined;

  function getTitle(ctx: ExtensionContext, prefix: string) {
    const cwd = basename(ctx.sessionManager.getCwd());
    const session = ctx.sessionManager.getSessionName();
    const title = session ? `${session} - ${cwd}` : cwd;
    return stripVTControlCharacters(`${prefix}   ${title}`).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  }

  function stopTitle(ctx: ExtensionContext) {
    if (titleTimer === undefined) return;
    clearInterval(titleTimer);
    titleTimer = undefined;
    if (ctx.mode === "tui") ctx.ui.setTitle(getTitle(ctx, "π"));
  }

  pi.on("agent_settled", (_event, ctx) => stopTitle(ctx));
  pi.on("session_shutdown", (_event, ctx) => stopTitle(ctx));

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || titleTimer !== undefined) return;

    let frameIndex = 0;
    const updateTitle = () => {
      ctx.ui.setTitle(getTitle(ctx, BRAILLE_FRAMES[frameIndex]!));
      frameIndex = (frameIndex + 1) % BRAILLE_FRAMES.length;
    };
    titleTimer = setInterval(updateTitle, 50);
  });

  pi.registerShortcut(BASH_MODE_HOTKEY, {
    description: "Cycle input mode (prompt / bash (included in context) / normal bash)",
    handler: () => activeEditor?.cycleMode(),
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setTitle(getTitle(ctx, "π"));

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
