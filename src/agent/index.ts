import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { agentsCommandHandler } from "./command.js";
import { loadMainAgent } from "./storage.js";
import { cycleMode } from "../permission/helpers.js";
import { readAgentMode } from "../permission/storage.js";
import { createState, getState, type AppState } from "../state.js";

export default function (pi: ExtensionAPI) {
  let state: AppState | undefined;
  let updateStatus: (() => void) | undefined;

  const updateAgentMode = (ctx: ExtensionContext) => {
    const mode = getState(pi).getMode();
    const modeText =
      mode === "yolo"
        ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
        : ctx.ui.theme.fg("dim", `${mode} mode`);
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // use ANSI cursor absolute (CHA) to jump to the right edge because spaces
    // would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("mode", `\x1b[${width}G` + modeText);
  };

  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: (_args, ctx) => agentsCommandHandler(ctx),
  });

  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle assistant, YOLO, and restricted modes",
    handler: (ctx) => {
      const nextMode = cycleMode(getState(pi).getMode());
      void getState(pi)
        .setMode(nextMode)
        .then(() => {
          ctx.ui.notify(`Mode: ${nextMode}`, "info");
        })
        .catch(() => ctx.ui.notify("Failed to change mode, please try again", "error"));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    state?.dispose();
    const [agent, mode] = await Promise.all([loadMainAgent(pi, ctx), readAgentMode()]);
    state = createState(pi, agent, mode, () => updateStatus?.());
    ctx.ui.setStatus("agent", ctx.ui.theme.fg("dim", `agent: ${agent.name}`));

    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
    updateStatus = () => updateAgentMode(ctx);
    updateStatus();
    process.stdout.on("resize", updateStatus);
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${getState(pi).getAgent().body}\n\n${event.systemPrompt}`,
  }));

  pi.on("session_shutdown", async (_event, _ctx) => {
    state?.dispose();
    state = undefined;
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
      updateStatus = undefined;
    }
  });
}
