import type {
  AgentSession,
  ExtensionCommandContext,
  ExtensionContext,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { SubsessionResult, SubsessionSnapshot } from "./types.js";
import { Container, Loader, Spacer, TruncatedText } from "@earendil-works/pi-tui";
import type { AgentMeta } from "../agent/types.js";
import { createQuestionnaireTool } from "../questionnaire/index.js";
import { enforceToolPermission } from "../permission/index.js";
import { findRecentModeOverride } from "../permission/helpers.js";
import { readAgentMode } from "../permission/storage.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const MARKDOWN_HEADING_PATTERN = /^\s*#\s+(.+?)\s*$/m;
const ACTIVITY_LABELS = [
  "analyzing",
  "researching",
  "synthesizing",
  "scrutinizing",
  "processing",
  "cooking",
] as const;

export function createSubsessionBridge(
  ctx: ExtensionContext,
  agentMeta: AgentMeta,
  sessionId: string,
): InlineExtension {
  return {
    name: "subsession-bridge",
    factory(pi) {
      pi.registerTool(createQuestionnaireTool(ctx));

      pi.on("tool_call", async (event) => {
        if (event.toolName === "subagent") {
          return { block: true, reason: "subagent tool is not allowed in subsession" };
        }

        const path = (event.input as { path?: unknown }).path;
        if (PATH_TOOLS.has(event.toolName) && typeof path !== "string") {
          return { block: true, reason: "Explicit path required in subsession" };
        }

        const mode =
          findRecentModeOverride(ctx.sessionManager.getEntries()) ?? (await readAgentMode(ctx.cwd));

        return enforceToolPermission(event, ctx, agentMeta, sessionId, mode === "yolo");
      });
    },
  };
}

function formatUsageCount(value: number): string {
  if (value >= 10000) {
    return `${Math.trunc(value / 1000)}k`;
  }
  return `${(value / 1000).toFixed(1)}k`;
}

export function extractSubsessionTitle(output: string): string | undefined {
  const headingMatch = output.match(MARKDOWN_HEADING_PATTERN);
  if (!headingMatch) return;

  const headingText = headingMatch[1]?.trim();
  if (!headingText) return;

  const separatorIndex = headingText.indexOf(":");
  const titleText =
    separatorIndex >= 0 ? headingText.slice(separatorIndex + 1).trim() : headingText;
  if (!titleText) return;

  return titleText;
}

export function createErrorResult(message: string): SubsessionResult {
  return {
    status: "error",
    output: message,
    usage: { input: 0, output: 0, toolCalls: 0 },
    toolCounts: {},
  };
}

export function renderSnapshotWidget(
  ctx: ExtensionCommandContext,
  label: string,
  snapshot: SubsessionSnapshot,
  contextWindow?: number,
) {
  const { usage, status, toolsUsed } = snapshot;
  const recentToolCalls = toolsUsed.slice(-5);
  const context = contextWindow ? `${((usage.input / contextWindow) * 100).toFixed(1)}%` : "n/a";
  const activity = ACTIVITY_LABELS[Math.floor(Math.random() * ACTIVITY_LABELS.length)]!;

  ctx.ui.setWidget(label, (tui, theme) => {
    const widget = new Container() as Container & { dispose?: () => void };
    const loader = new Loader(
      tui,
      (content) => theme.fg("accent", content),
      (content) => theme.fg("muted", content),
      `${label} (${activity}): tools_used=${usage.toolCalls} | in=${formatUsageCount(usage.input)} | out=${formatUsageCount(usage.output)} | ctx=${context}`,
    );

    if (status !== "running") {
      loader.setIndicator({ frames: ["•"] });
    }

    widget.addChild(loader);

    const lastToolCallIndex = recentToolCalls.length - 1;
    for (let toolCallIndex = 0; toolCallIndex < recentToolCalls.length; toolCallIndex += 1) {
      const branchIndicator = toolCallIndex === lastToolCallIndex ? "└─" : "├─";
      const toolCallLine = `  ${branchIndicator} ${recentToolCalls[toolCallIndex]}`;
      widget.addChild(new TruncatedText(toolCallLine, 1, 0));
    }

    widget.addChild(new Spacer(1));
    widget.dispose = () => loader.stop();
    return widget;
  });
}

export function formatToolUse(name: string, argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return `${name}()`;
  }
  try {
    return `${name}(${JSON.stringify(argumentsValue)})`;
  } catch {
    return `${name}(<args>)`;
  }
}

export function getLastAssistantOutput(session: AgentSession): string {
  for (const message of [...session.messages].reverse()) {
    if (message.role !== "assistant") continue;
    for (const contentPart of [...message.content].reverse()) {
      if (contentPart.type === "text") {
        return contentPart.text;
      }
    }
  }
  return "";
}
