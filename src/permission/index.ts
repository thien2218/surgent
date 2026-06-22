import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { handlePermissionsCommand } from "./command.js";
import { checkAgentRules, resolvePermission } from "./resolution.js";
import { getPiIgnoreInputs, resolvePiIgnorePathBlock } from "./piignore.js";
import { addRule, readAgentMode, writeAgentMode } from "./storage.js";
import { loadMainAgent } from "../agent/storage.js";
import type { AgentMode, PromptDecision } from "./types.js";
import PermissionPrompt from "./components/prompt.js";
import { toPermExpr } from "./expression.js";
import { IS_SUBSESSION } from "../subsession/index.js";
import { findRecentModeOverride, getPermissionCheck } from "./helpers.js";
import type { AgentMeta } from "../agent/types.js";

const SWITCH_MODE_KEY = Key.ctrlAlt("y");

export default function (pi: ExtensionAPI) {
  let agentMeta: AgentMeta;
  let agentMode: AgentMode;
  let turnMode: AgentMode | null = null;
  let agentLoaded = false;
  let updateStatus: (() => void) | undefined;

  const updateAgentMode = (ctx: ExtensionContext) => {
    const effectiveMode = turnMode ?? agentMode;
    const modeText =
      effectiveMode === "yolo"
        ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
        : ctx.ui.theme.fg("dim", "assistant mode");
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // statuses are sorted alphabetically and joined with " "; use ANSI cursor absolute (CHA)
    // to jump to the right edge — spaces would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("mode", `\x1b[${width}G` + modeText);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (IS_SUBSESSION) return;
    if (!agentLoaded) {
      [agentMeta, agentMode] = await Promise.all([loadMainAgent(pi, ctx), readAgentMode(ctx.cwd)]);
      agentLoaded = true;
    }
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }

    updateStatus = () => updateAgentMode(ctx);
    updateStatus();
    process.stdout.on("resize", updateStatus);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (IS_SUBSESSION) return;
    turnMode = findRecentModeOverride(ctx.sessionManager.getEntries()) ?? null;
    updateStatus?.();
  });

  pi.on("agent_end", async (_event, _ctx) => {
    if (IS_SUBSESSION) return;
    turnMode = null;
    updateStatus?.();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
  });

  pi.registerShortcut(SWITCH_MODE_KEY, {
    description: "Toggle YOLO mode (bypass all access control)",
    handler: async (ctx) => {
      agentMode = agentMode === "yolo" ? "assistant" : "yolo";
      await writeAgentMode(ctx.cwd, agentMode);
      updateStatus?.();

      ctx.ui.notify(
        agentMode === "yolo"
          ? "YOLO mode ON - agents can now run commands and tools without asking for permission"
          : "YOLO mode OFF",
        "info",
      );
    },
  });

  pi.registerCommand("permissions", {
    description: "View and manage file, web, and bash permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    for (const input of getPiIgnoreInputs(event)) {
      const piIgnoreBlock = await resolvePiIgnorePathBlock(ctx.cwd, input);
      if (piIgnoreBlock) {
        return { block: true, reason: piIgnoreBlock };
      }
    }

    const check = getPermissionCheck(event);
    if (!check || (turnMode ?? agentMode) === "yolo") return;

    const runtimeAllowed = checkAgentRules(agentMeta, check);
    if (!runtimeAllowed) {
      return { block: true, reason: "Access to this resource is beyond allowed scope" };
    }

    const sessionId = ctx.sessionManager.getSessionId();
    const expr = toPermExpr(check.toolName, check.raw);
    const permission = await resolvePermission(ctx.cwd, sessionId, check);
    if (permission === "allowed" && !check.danger) return;

    const reason =
      permission === "blocked"
        ? "Access to this resource is denied"
        : !ctx.hasUI
          ? "No UI to prompt for permission in current mode"
          : undefined;
    if (reason) return { block: true, reason };

    const decision = await ctx.ui.custom<PromptDecision>((_tui, theme, _keybindings, done) => {
      const component = new PermissionPrompt(theme, expr, check);
      component.onDone = done;
      component.onStoreRule = (...args) => addRule(ctx.cwd, sessionId, ...args);
      return component;
    });

    if (!decision.allowed) {
      const appended = decision.amended ? `. Reason: ${decision.amended}` : "";
      return {
        block: true,
        reason: `User rejected this tool call. Find a different approach, or skip this step, or abort and report if cannot proceed${appended}`,
      };
    }
    if (decision.amended) {
      return {
        block: true,
        reason: `User allow this tool call, but with notes: ${decision.amended}`,
      };
    }
  });
}
