import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { agentsCommandHandler } from "./command.js";
import { loadMainAgent } from "./load.js";
import { loadAgents, initStates, writeStates } from "./storage.js";
import { loadResolvedConfigSet } from "../mcp-client/storage.js";
import type { SessionState } from "./types.js";

const SWITCH_MODE_KEY = Key.ctrlAlt("y");

export default function (pi: ExtensionAPI) {
  let states: SessionState = { yolo: false, agent: "default" };
  let sessionId: string | null = null;

  const updateAgent = (ctx: ExtensionContext) => {
    const agentText = ctx.ui.theme.fg("dim", `agent: ${states.agent}`);
    ctx.ui.setStatus("agent", agentText);
  };

  const updateAgentMode = (ctx: ExtensionContext) => {
    const modeText = states.yolo
      ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
      : ctx.ui.theme.fg("dim", "assistant mode");
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // statuses are sorted alphabetically and joined with " "; use ANSI cursor absolute (CHA)
    // to jump to the right edge — spaces would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("yolo-mode", `\x1b[${width}G` + modeText);
  };

  let updateStatus: (() => void) | undefined;

  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: (_args, ctx) => agentsCommandHandler(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    states = await initStates(ctx.cwd, sessionId);

    updateStatus = () => {
      updateAgentMode(ctx);
      updateAgent(ctx);
    };
    updateStatus();
    process.stdout.on("resize", updateStatus);

    const [agents, allMcpConfigs] = await Promise.all([
      loadAgents(ctx.cwd),
      loadResolvedConfigSet(ctx.cwd),
    ]);

    const { tools, model } = await loadMainAgent(ctx, agents, {
      tools: pi.getAllTools().map((tool) => tool.name),
      mcp: allMcpConfigs.filter((cfg) => cfg.enabled === true),
    });

    if (tools) {
      pi.setActiveTools(tools);
    }
    if (model) {
      const ok = pi.setModel(model);
      if (!ok) ctx.ui.notify("Agent model unavailable", "warning");
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
  });

  pi.registerShortcut(SWITCH_MODE_KEY, {
    description: "Toggle YOLO mode (bypass all access control)",
    handler: async (ctx) => {
      if (!sessionId) return;
      states = { ...states, yolo: !states.yolo };
      await writeStates(ctx.cwd, sessionId, states);
      updateStatus?.();

      ctx.ui.notify(
        states.yolo
          ? "YOLO mode ON - agents can now run commands and tools without asking for permission"
          : "YOLO mode OFF",
        "info",
      );
    },
  });
}
