import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { cleanup } from "./cleanup.js";
import { getSessionId, handlePermissionsCommand } from "./command.js";
import { resolvePermission } from "./resolution.js";
import type { PermCheck, PromptDecision, PermissiveToolName } from "./types.js";
import { isYolo } from "../agents/states.js";
import PermissionPrompt from "./prompt.js";
import { PERMISSIVE_TOOLS } from "./constants.js";

function getPermissionCheck(event: ToolCallEvent): PermCheck | null {
  for (const [name, data] of Object.entries(PERMISSIVE_TOOLS)) {
    const toolName = name as PermissiveToolName;
    if (isToolCallEventType(toolName, event)) {
      return { toolName, ...data, expr: "" }; // TODO: need some picomatch-compliant expression produced via some algorithm performed on event's data
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    sessionId = getSessionId(ctx.sessionManager);
    cleanup(ctx.cwd);
  });

  pi.registerCommand("permissions", {
    description: "View and manage file, web, and bash permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isYolo() || !sessionId) return;

    const check = getPermissionCheck(event);
    if (!check) return;

    const allowed = await resolvePermission(ctx.cwd, sessionId, check);
    if (allowed) return;

    if (!ctx.hasUI) {
      return { block: true, reason: "No UI to prompt for permission" };
    }

    const decision = await ctx.ui.custom<PromptDecision>((tui, theme, _keybindings, done) => {
      const component = new PermissionPrompt(tui, theme, check);
      component.onDone = done;
      return component;
    });

    // If not allowed => tell agent that user rejected this tool call
    // If allowed but amended is provided => blocks tool call and tell agent what user wants
    // If allowed and no amended provided => proceed tool call
  });
}
