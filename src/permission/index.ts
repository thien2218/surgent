import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handlePermissionsCommand } from "./command.js";
import { getState } from "../state.js";
import { checkAgentRules, resolvePermission } from "./resolution.js";
import { resolvePiIgnorePathBlock } from "./piignore.js";
import type { PermissionCheck, PromptDecision } from "./types.js";
import PermissionPrompt from "./components/prompt.js";
import { getPermissionCheck } from "./helpers.js";
import { isDeny } from "./precedence.js";

export async function askForPermission(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  check: PermissionCheck,
) {
  if (!ctx.hasUI) {
    return { block: true, reason: "Permission request requires interactive UI" };
  }

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

export default function (pi: ExtensionAPI) {
  pi.registerCommand("permissions", {
    description: "View and manage permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    const state = getState(pi);
    const { meta } = state.getAgent();
    const mode = state.getMode();

    try {
      const check = await getPermissionCheck(
        ctx.cwd,
        ctx.sessionManager.getSessionId(),
        event.toolName,
        event.input,
      );
      if (!check) return;

      if (check.category === "file") {
        const piIgnoreBlock = await resolvePiIgnorePathBlock(ctx.cwd, check.raw);
        if (piIgnoreBlock) {
          return { block: true, reason: piIgnoreBlock };
        }
      }
      if (!checkAgentRules(meta, check)) {
        return { block: true, reason: "Access to this resource is beyond allowed scope" };
      }

      const permission = await resolvePermission(ctx.cwd, check, mode);
      if (isDeny(permission)) {
        return {
          block: true,
          reason: `Access to this resource is denied by policy rule: ${permission}`,
        };
      }
      if (mode === "yolo") return;
      if (permission === "allowed" && !check.uncertainty) return;

      return askForPermission(pi, ctx, check);
    } catch {
      return { block: true, reason: "Permission check failed" };
    }
  });
}
