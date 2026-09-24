import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { handlePermissionsCommand } from "./command.js";
import { getState } from "../state.js";
import { checkAgentRules, resolvePermission } from "./resolution.js";
import { getPiIgnoreInputs, resolvePiIgnorePathBlock } from "./piignore.js";
import type { PermissionCheck, PromptDecision } from "./types.js";
import PermissionPrompt from "./components/prompt.js";
import { getPermissionCheck } from "./helpers.js";
import type { AgentMeta, AgentMode } from "../agent/types.js";

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
  if (decision.error) {
    ctx.ui.notify(
      "Failed to save permission rules, use `/permissions` to set them manually",
      "error",
    );
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
      const piIgnoreBlock = await resolvePiIgnorePathBlock(ctx.cwd, input.path, input.glob);
      if (piIgnoreBlock) {
        return { block: true, reason: piIgnoreBlock };
      }
    }

    const check = await getPermissionCheck(ctx.cwd, sessionId, event.toolName, event.input);
    if (!check) return;
    if (!checkAgentRules(meta, check)) {
      return { block: true, reason: "Access to this resource is beyond allowed scope" };
    }

    const permission = await resolvePermission(ctx.cwd, check, mode);
    if (permission === "deny") {
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
  pi.registerCommand("permissions", {
    description: "View and manage permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    const state = getState(pi);
    const { meta } = state.getAgent();
    const mode = state.getMode();
    return enforceToolPermission(pi, event, ctx, meta, ctx.sessionManager.getSessionId(), mode);
  });
}
