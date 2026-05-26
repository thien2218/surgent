import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { agentsCommandHandler } from "./command.js";
import { registerAgentHooks } from "./load.js";
import { getActiveAgent, isYolo, toggleYolo } from "./states.js";
import { getPiGlobalPath } from "../utils.js";

const SWITCH_MODE_KEY = Key.ctrlAlt("y");

export default function (pi: ExtensionAPI) {
  registerAgentHooks(pi);

  const updateAgent = (ctx: ExtensionContext) => {
    const agentText = ctx.ui.theme.fg("dim", `Agent: ${getActiveAgent()}`);
    ctx.ui.setStatus("agent", agentText);
  };

  const updateAgentMode = (ctx: ExtensionContext) => {
    const modeText = isYolo()
      ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
      : ctx.ui.theme.fg("dim", "Assistant mode");
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // statuses are sorted alphabetically and joined with " "; use ANSI cursor absolute (CHA)
    // to jump to the right edge — spaces would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("yolo-mode", `\x1b[${width}G` + modeText);
  };

  let updateStatus: (() => void) | undefined;

  pi.on("resources_discover", () => ({
    promptPaths: [getPiGlobalPath("agent-prompt")],
  }));

  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: agentsCommandHandler,
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus = () => {
      updateAgentMode(ctx);
      updateAgent(ctx);
    };
    updateStatus();
    process.stdout.on("resize", updateStatus);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
  });

  pi.registerShortcut(SWITCH_MODE_KEY, {
    description: "Toggle YOLO mode (bypass all access control)",
    handler: async (ctx) => {
      toggleYolo();
      updateStatus?.();
      ctx.ui.notify(
        isYolo()
          ? "YOLO mode ON - agents can now run commands and tools without asking for permission"
          : "YOLO mode OFF",
        "info",
      );
    },
  });
}
