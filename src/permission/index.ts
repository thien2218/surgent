import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { handlePermissionsCommand } from "./command.js";
import { checkAgentRules, resolvePermission } from "./resolution.js";
import { getPiIgnoreInputs, resolvePiIgnorePathBlock } from "./piignore.js";
import { readAgentMode, writeAgentMode } from "./storage.js";
import { loadMainAgent } from "../agent/storage.js";
import type { PermissionCheck, PromptDecision } from "./types.js";
import PermissionPrompt from "./components/prompt.js";
import { findRecentModeOverride, getPermissionCheck, cycleMode } from "./helpers.js";
import type { AgentMeta, AgentMode } from "../agent/types.js";

async function askForPermission(pi: ExtensionAPI, ctx: ExtensionContext, check: PermissionCheck) {
  const decision = await ctx.ui.custom<PromptDecision>((_tui, theme, _keybindings, done) => {
    const component = new PermissionPrompt(theme, check, ctx.cwd);
    component.onDone = done;
    return component;
  });

  if (!decision.allowed) {
    const appended = decision.amended ? `. User input: ${decision.amended}` : "";
    return {
      block: true,
      reason: `User rejected this tool call. Find a different approach, or skip this step, or abort and report if cannot proceed${appended}`,
    };
  }
  if (decision.amended) {
    pi.sendUserMessage(decision.amended, { deliverAs: "steer" });
  }
}

export async function enforceToolPermission(
  pi: ExtensionAPI,
  event: ToolCallEvent,
  ctx: ExtensionContext,
  agentMeta: AgentMeta,
  sessionId: string,
  agentMode: AgentMode,
) {
  for (const input of getPiIgnoreInputs(event)) {
    const piIgnoreBlock = await resolvePiIgnorePathBlock(ctx.cwd, input);
    if (piIgnoreBlock) {
      return { block: true, reason: piIgnoreBlock };
    }
  }

  const check = getPermissionCheck(sessionId, event.toolName, event.input);
  if (!check) return;
  if (!checkAgentRules(agentMeta, check)) {
    return { block: true, reason: "Access to this resource is beyond allowed scope" };
  }

  const permission = await resolvePermission(ctx.cwd, check, agentMode);
  if (permission === "blocked") {
    return { block: true, reason: "Access to this resource is denied" };
  }
  if (agentMode === "yolo") return;
  if (permission === "allowed" && !check.uncertainty) return;
  if (!ctx.hasUI) {
    return { block: true, reason: "Permission request requires interactive UI" };
  }

  return askForPermission(pi, ctx, check);
}

export default function (pi: ExtensionAPI) {
  let agentMeta: AgentMeta;
  let agentMode: AgentMode;
  let turnMode: AgentMode | null = null;
  let updateStatus: (() => void) | undefined;

  const updateAgentMode = (ctx: ExtensionContext) => {
    const mode = turnMode ?? agentMode;
    const modeText =
      mode === "yolo"
        ? ctx.ui.theme.fg("warning", "YOLO mode ⚠️")
        : mode === "restricted"
          ? ctx.ui.theme.fg("dim", "restricted mode")
          : ctx.ui.theme.fg("dim", "assistant mode");
    const width = (process.stdout.columns ?? 80) - visibleWidth(modeText) + 1;
    // statuses are sorted alphabetically and joined with " "; use ANSI cursor absolute (CHA)
    // to jump to the right edge — spaces would be collapsed by sanitizeStatusText
    ctx.ui.setStatus("mode", `\x1b[${width}G` + modeText);
  };

  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle assistant, YOLO, and restricted modes",
    handler: async (ctx) => {
      agentMode = cycleMode(agentMode);
      await writeAgentMode(ctx.cwd, agentMode);
      updateStatus?.();

      ctx.ui.notify(
        agentMode === "yolo"
          ? "YOLO mode ON - agents can now run commands and tools without asking"
          : "YOLO mode OFF",
        "info",
      );
    },
  });

  pi.registerCommand("permissions", {
    description: "View and manage permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("session_start", async (_event, ctx) => {
    [agentMeta, agentMode] = await Promise.all([loadMainAgent(pi, ctx), readAgentMode(ctx.cwd)]);
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
    updateStatus = () => updateAgentMode(ctx);
    updateStatus();
    process.stdout.on("resize", updateStatus);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    turnMode = findRecentModeOverride(ctx.sessionManager.getEntries()) ?? null;
    updateStatus?.();
  });

  pi.on("agent_end", async (_event, _ctx) => {
    turnMode = null;
    updateStatus?.();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
  });

  pi.on("tool_call", async (event, ctx) =>
    enforceToolPermission(
      pi,
      event,
      ctx,
      agentMeta,
      ctx.sessionManager.getSessionId(),
      turnMode ?? agentMode,
    ),
  );
}
