import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { agentsCommandHandler } from "./command.js";
import { loadMainAgent } from "./storage.js";
import { cycleMode } from "../permission/helpers.js";
import { readAgentMode } from "../permission/storage.js";
import { createState, getState, type AppState } from "../state.js";
import { findSubsession } from "../subagent/storage.js";

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
          updateStatus?.();
          ctx.ui.notify(`Mode: ${nextMode}`, "info");
        })
        .catch(() => ctx.ui.notify("Failed to change mode, please try again", "error"));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    state?.dispose();
    state = undefined;
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
      updateStatus = undefined;
    }

    try {
      const [agent, mode, subsession] = await Promise.all([
        loadMainAgent(pi, ctx),
        readAgentMode(),
        findSubsession(ctx.cwd, ctx.sessionManager.getSessionId()),
      ]);
      state = createState(pi, agent, mode, subsession?.pid);
      ctx.ui.setStatus("agent", ctx.ui.theme.fg("dim", `agent: ${agent.name}`));

      updateStatus = () => updateAgentMode(ctx);
      updateStatus();
      process.stdout.on("resize", updateStatus);
    } catch (error) {
      pi.setActiveTools([]);
      ctx.ui.notify(
        `Failed to load 'general' agent: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      ctx.shutdown();
    }
  });

  pi.on("before_agent_start", (event) => {
    const { body } = getState(pi).getAgent();
    if (body) {
      event.systemPromptOptions.sections.agent = body;
    } else {
      delete event.systemPromptOptions.sections.agent;
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    state?.dispose();
    state = undefined;
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
      updateStatus = undefined;
    }
  });
}
