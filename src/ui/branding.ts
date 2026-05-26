import { VERSION as PI_VERSION, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

const PACKAGE_JSON_PATH = new URL("../../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
  name: string;
  version: string;
};

const APP_NAME = packageJson.name;
const APP_VERSION = packageJson.version;

export function brandingSessionStartHandler(_event: unknown, ctx: ExtensionContext) {
  if (!ctx.hasUI) return;

  ctx.ui.setHeader((_tui, theme) => ({
    render: () => [
      `${theme.bold(theme.fg("accent", APP_NAME))}${theme.fg("dim", ` v${APP_VERSION} · built on top of pi v${PI_VERSION}`)}`,
    ],
    invalidate() {},
  }));
}
