import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isYolo, toggleYolo } from "./yolo.js";
import { Key, visibleWidth } from "@earendil-works/pi-tui";

const SWITCH_MODE_KEY = Key.ctrlAlt("y");

export default function (pi: ExtensionAPI) {
  const updateStatus = (ctx: ExtensionContext) => {
    const agentText = ctx.ui.theme.fg("dim", "Agent: default");
    const modeText = isYolo()
      ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
      : ctx.ui.theme.fg("dim", "Assistant mode");
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // statuses are sorted alphabetically and joined with " "; use ANSI cursor
    // absolute (CHA) to jump to the right edge — spaces would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("agent", agentText);
    ctx.ui.setStatus("yolo-mode", `\x1b[${width}G` + modeText);
  };

  let handleResize: (() => void) | undefined;

  pi.on("session_start", async (_event, ctx) => {
    handleResize = () => updateStatus(ctx);
    handleResize();
    process.stdout.on("resize", handleResize);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (handleResize) {
      process.stdout.off("resize", handleResize);
    }
  });

  pi.registerShortcut(SWITCH_MODE_KEY, {
    description: "Toggle YOLO mode (bypass all access control)",
    handler: async (ctx) => {
      toggleYolo();
      updateStatus(ctx);
      ctx.ui.notify(
        isYolo()
          ? "YOLO mode ON - agents can now run commands and tools without asking for permission"
          : "YOLO mode OFF",
        "info",
      );
    },
  });
}
