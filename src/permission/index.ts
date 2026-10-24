import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handlePermissionsCommand } from "./command.js";
import { getState } from "../state.js";
import { checkAgentRules, resolvePermission } from "./resolution.js";
import { resolvePiIgnorePathBlock } from "./piignore.js";
import type { PermissionCheck, PromptDecision } from "./types.js";
import PermissionPrompt from "./components/prompt.js";
import { getPermissionCheck } from "./helpers.js";
import { isDeny } from "./precedence.js";
import { parsePatch } from "../apply-patch/patch.js";
import type { Hunk } from "../apply-patch/types.js";

function permissionCalls(toolName: string, input: Record<string, unknown>) {
  if (toolName !== "apply_patch") return [{ toolName, input }];

  let hunks: Hunk[];
  try {
    hunks = parsePatch(typeof input.patchText === "string" ? input.patchText : "");
  } catch {
    return [];
  }
  return hunks
    .flatMap((hunk) =>
      hunk.type === "update" && hunk.movePath ? [hunk.path, hunk.movePath] : [hunk.path],
    )
    .map((path) => ({ toolName: "write", input: { path } }));
}

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
    const sessionId = state.pid ?? ctx.sessionManager.getSessionId();

    try {
      for (const call of permissionCalls(event.toolName, event.input)) {
        const check = await getPermissionCheck(ctx.cwd, sessionId, call.toolName, call.input);
        if (!check) continue;

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
        if (mode === "yolo") continue;
        if (permission === "allowed" && !check.uncertainty) continue;

        const decision = await askForPermission(pi, ctx, check);
        if (decision) return decision;
      }
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : "Permission check failed",
      };
    }
  });
}
