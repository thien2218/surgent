import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  BashToolCallEvent,
  ReadToolCallEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { cleanup } from "./cleanup.js";
import { handlePermissionsCommand } from "./command.js";
import { resolvePermission } from "./resolution.js";
import { getPiIgnoreInputs, resolvePiIgnorePathBlock } from "./piignore.js";
import { addRule, checkExprStored, readAgentMode, writeAgentMode } from "./storage.js";
import type { AgentMode, PermissionCheck, PromptDecision, PermissiveToolName } from "./types.js";
import { readSessionAgent } from "../agent/storage.js";
import { MODE_ENTRY } from "../commands/index.js";
import PermissionPrompt from "./components/prompt.js";
import { SUSPICIOUS_BASH_PATTERNS, PERMISSIVE_TOOLS } from "./constants.js";
import { toPermExpr } from "./expression.js";
import { IS_SUBSESSION } from "../subsession/index.js";

const SWITCH_MODE_KEY = Key.ctrlAlt("y");

function getPermissionCheck(event: ToolCallEvent): PermissionCheck | null {
  if (!(event.toolName in PERMISSIVE_TOOLS)) return null;
  const toolName = event.toolName as PermissiveToolName;
  let danger: string | undefined;
  let raw: string;

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      raw = (event as ReadToolCallEvent).input.path;
      break;
    case "bash":
      raw = (event as BashToolCallEvent).input.command;
      break;
    case "web_fetch":
      raw = (event.input as Record<"url", string>).url;
      break;
  }

  if (toolName === "bash") {
    for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
      if (pattern.test(raw)) danger = reason;
    }
  }

  return { toolName, ...PERMISSIVE_TOOLS[toolName], danger, raw };
}

function findRecentModeOverride(entries: SessionEntry[]): AgentMode | null {
  const startIndex = Math.max(0, entries.length - 5);

  for (let entryIndex = entries.length - 1; entryIndex >= startIndex; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry || entry.type !== "custom" || entry.customType !== MODE_ENTRY) {
      continue;
    }
    return (entry.data as { mode: AgentMode }).mode;
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | null = null;
  let agentMode: AgentMode = "assistant";
  let turnMode: AgentMode | null = null;
  let agentModeLoaded = false;
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
    sessionId = ctx.sessionManager.getSessionId();
    turnMode = null;
    cleanup(ctx.cwd);

    if (!agentModeLoaded) {
      agentMode = await readAgentMode(ctx.cwd);
      agentModeLoaded = true;
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
    const effectiveMode = turnMode ?? agentMode;
    if (!check || effectiveMode === "yolo" || !sessionId) return;

    const agent = await readSessionAgent(ctx.cwd, sessionId);
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
