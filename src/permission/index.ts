import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolCallEvent,
  type BashToolCallEvent,
  type ReadToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { cleanup } from "./cleanup.js";
import { handlePermissionsCommand } from "./command.js";
import { resolvePermission } from "./resolution.js";
import { addRule, checkExprStored } from "./storage.js";
import type { PermissionCheck, PromptDecision, PermissiveToolName } from "./types.js";
import { readStates } from "../agents/storage.js";
import PermissionPrompt from "./components/prompt.js";
import { SUSPICIOUS_BASH_PATTERNS, PERMISSIVE_TOOLS } from "./constants.js";
import { toPermExpr } from "./expression.js";
import { IS_SUBSESSION } from "../subsession/index.js";

function getRawInput(toolName: PermissiveToolName, event: ToolCallEvent) {
  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return (event as ReadToolCallEvent).input.path;
    case "bash":
      return (event as BashToolCallEvent).input.command;
    case "web_fetch":
      return (event.input as Record<"url", string>).url;
  }
}

function getPermissionCheck(event: ToolCallEvent): PermissionCheck | null {
  for (const [name, data] of Object.entries(PERMISSIVE_TOOLS)) {
    const toolName = name as PermissiveToolName;
    if (isToolCallEventType(toolName, event)) {
      let danger: string | undefined;
      const raw = getRawInput(toolName, event);

      if (toolName === "bash") {
        for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
          if (pattern.test(raw as string)) {
            danger = reason;
          }
        }
      }

      return { toolName, ...data, danger, raw };
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    if (IS_SUBSESSION) return;
    sessionId = ctx.sessionManager.getSessionId();
    cleanup(ctx.cwd);
  });

  pi.registerCommand("permissions", {
    description: "View and manage file, web, and bash permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!sessionId) return;
    const { yolo, agent } = await readStates(ctx.cwd, sessionId);
    if (yolo) return;

    const check = getPermissionCheck(event);
    if (!check) return;

    const expr = toPermExpr(check.toolName, check.raw);
    const allowed = await resolvePermission(ctx.cwd, sessionId, agent, check);
    if (allowed && !check.danger) return;

    if (!ctx.hasUI) {
      return { block: true, reason: "No UI to prompt for permission" };
    }

    const exprExists = expr ? await checkExprStored(ctx.cwd, check.category, expr) : false;

    const decision = await ctx.ui.custom<PromptDecision>((_tui, theme, _keybindings, done) => {
      const component = new PermissionPrompt(theme, expr, check, exprExists);
      component.onDone = done;
      component.onStoreRule = (...args) => addRule(ctx.cwd, sessionId!, ...args);
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
