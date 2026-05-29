import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolCallEvent,
  type BashToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { cleanup } from "./cleanup.js";
import { getSessionId, handlePermissionsCommand } from "./command.js";
import { resolvePermission } from "./resolution.js";
import { addRule, checkExprStored } from "./storage.js";
import type { PermCheck, PromptDecision, PermissiveToolName } from "./types.js";
import { isYolo } from "../agents/states.js";
import PermissionPrompt from "./components/prompt.js";
import { SUSPICIOUS_BASH_PATTERNS, PERMISSIVE_TOOLS } from "./constants.js";
import { toPermExpr } from "./expression.js";

function getPermissionCheck(event: ToolCallEvent): PermCheck | null {
  for (const [name, data] of Object.entries(PERMISSIVE_TOOLS)) {
    const toolName = name as PermissiveToolName;
    if (isToolCallEventType(toolName, event)) {
      let danger: string | undefined;
      const expr = toPermExpr(toolName, event.input as Record<string, unknown>);

      if (toolName === "bash") {
        const fullCmd = (event as BashToolCallEvent).input.command;
        for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
          if (pattern.test(fullCmd)) {
            danger = reason;
          }
        }
      }

      return { toolName, ...data, expr, danger };
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
    if (allowed && !check.danger) return;

    if (!ctx.hasUI) {
      return { block: true, reason: "No UI to prompt for permission" };
    }

    const exprExists = check.expr
      ? await checkExprStored(ctx.cwd, check.category, check.expr)
      : false;

    const decision = await ctx.ui.custom<PromptDecision>((tui, theme, _keybindings, done) => {
      const component = new PermissionPrompt(tui, theme, check, exprExists);
      component.onDone = done;
      component.onStoreRule = (...args) => addRule(ctx.cwd, sessionId!, ...args);
      return component;
    });

    if (!decision || !decision.allowed) {
      return { block: true, reason: decision?.amended ?? "User rejected this tool call" };
    }
    if (decision.amended) {
      return { block: true, reason: decision.amended };
    }
  });
}
