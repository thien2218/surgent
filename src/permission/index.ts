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
import { getPermissionCheck, cycleMode } from "./helpers.js";
import type { Agent, AgentMeta, AgentMode } from "../agent/types.js";

async function askForPermission(pi: ExtensionAPI, ctx: ExtensionContext, check: PermissionCheck) {
  const decision = await ctx.ui.custom<PromptDecision | undefined>(
    (_tui, theme, _keybindings, done) => {
      const component = new PermissionPrompt(theme, check, ctx.cwd);
      component.onDone = done;
      return component;
    },
  );

  if (!decision) {
    return { block: true, reason: "Permission request was cancelled" };
  }
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
  meta: AgentMeta,
  sessionId: string,
  mode: AgentMode,
) {
  try {
    for (const input of getPiIgnoreInputs(event)) {
      const piIgnoreBlock = await resolvePiIgnorePathBlock(ctx.cwd, input);
      if (piIgnoreBlock) {
        return { block: true, reason: piIgnoreBlock };
      }
    }

    const check = getPermissionCheck(sessionId, event.toolName, event.input);
    if (!check) return;
    if (!checkAgentRules(meta, check)) {
      return { block: true, reason: "Access to this resource is beyond allowed scope" };
    }

    const permission = await resolvePermission(ctx.cwd, check, mode);
    if (permission === "blocked") {
      return { block: true, reason: "Access to this resource is denied" };
    }
    if (mode === "yolo") return;
    if (permission === "allowed" && !check.uncertainty) return;
    if (!ctx.hasUI) {
      return { block: true, reason: "Permission request requires interactive UI" };
    }

    return await askForPermission(pi, ctx, check);
  } catch {
    return { block: true, reason: "Permission check failed" };
  }
}

export default function (pi: ExtensionAPI) {
  let agent: Agent;
  let mode: AgentMode;
  let updateStatus: (() => void) | undefined;

  const updateAgentMode = (ctx: ExtensionContext) => {
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
      const nextMode = cycleMode(mode);
      await writeAgentMode(nextMode);
      mode = nextMode;
      updateStatus?.();

      ctx.ui.notify(
        mode === "yolo"
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
    [agent, mode] = await Promise.all([loadMainAgent(pi, ctx), readAgentMode()]);
    ctx.ui.setStatus("agent", ctx.ui.theme.fg("dim", `agent: ${agent.name}`));

    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
    }
    updateStatus = () => updateAgentMode(ctx);
    updateStatus();
    process.stdout.on("resize", updateStatus);
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${agent.body}\n\n${event.systemPrompt}`,
  }));

  pi.on("session_shutdown", async (_event, _ctx) => {
    if (updateStatus) {
      process.stdout.off("resize", updateStatus);
      updateStatus = undefined;
    }
  });

  pi.on("tool_call", async (event, ctx) =>
    enforceToolPermission(pi, event, ctx, agent.meta, ctx.sessionManager.getSessionId(), mode),
  );
}
