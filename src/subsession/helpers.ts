import { existsSync } from "node:fs";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Interaction, SubsessionResult, SubsessionSnapshot } from "./types.js";
import { IS_SUBSESSION } from "./index.js";
import { askQuestions } from "../questionnaire/helpers.js";
import type { Question } from "../questionnaire/types.js";
import type { PermissionCheck } from "../permission/types.js";
import { askForPermission } from "../permission/index.js";
import { addRule } from "../permission/storage.js";
import { PERMISSIVE_TOOLS } from "../permission/constants.js";
import { Container, Loader, Spacer, TruncatedText } from "@earendil-works/pi-tui";

const MARKDOWN_HEADING_PATTERN = /^\s*#\s+(.+?)\s*$/m;
const HANDOFF_PREFIX = "subsession_handoff:";
const ACTIVITY_LABELS = [
  "analyzing",
  "researching",
  "synthesizing",
  "scrutinizing",
  "processing",
  "cooking",
] as const;

function formatUsageCount(value: number): string {
  if (value >= 10000) {
    return `${Math.trunc(value / 1000)}k`;
  }
  return `${(value / 1000).toFixed(1)}k`;
}

export function emitInteractionHandoff(toolName: string, input: any, ctx: ExtensionContext) {
  if (ctx.hasUI || !IS_SUBSESSION) return;
  const serializedRequest = JSON.stringify({ toolName, input });
  process.stderr.write(`${HANDOFF_PREFIX}${serializedRequest}\n`);
  ctx.abort();
  return { block: true, reason: "Interactive tool call requires handoff to parent session UI." };
}

export function parseInteractionHandoff(output: string): Interaction | undefined {
  const outputLines = output.split(/\r?\n/);
  for (let idx = outputLines.length - 1; idx >= 0; idx--) {
    const line = outputLines[idx];
    if (!line || !line.startsWith(HANDOFF_PREFIX)) {
      continue;
    }

    try {
      const parsed = JSON.parse(line.slice(HANDOFF_PREFIX.length)) as Interaction;
      return parsed;
    } catch {
      continue;
    }
  }
  return;
}

export function createResumeInput(toolName: string, result: unknown): string {
  let serialized = "{}";
  try {
    serialized = JSON.stringify(result);
  } catch {
    serialized = JSON.stringify({ cancelled: true, reason: "Failed to serialize result" });
  }

  return [
    "[RESUMED_TOOL_RESULT]",
    `toolName: ${toolName}`,
    `result: ${serialized}`,
    "[/RESUMED_TOOL_RESULT]",
  ].join("\n");
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

export function getSurgentInvoker(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const executableName = currentScript?.split("/").pop()?.toLowerCase() ?? "";
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(executableName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "surgent", args };
}

export function createErrorResult(message: string): SubsessionResult {
  return {
    status: "error",
    output: message,
    usage: { input: 0, output: 0, toolCalls: 0 },
    toolCounts: {},
  };
}

export async function resolveInteractionHandoff(
  ctx: ExtensionCommandContext,
  interaction?: Interaction,
): Promise<string | undefined> {
  if (!interaction) {
    return;
  }

  const { toolName, input } = interaction;
  if (toolName === "questionnaire") {
    const result = await askQuestions(input["questions"] as Question[], ctx.ui);
    return createResumeInput(toolName, result);
  }
  if (toolName in PERMISSIVE_TOOLS) {
    const check = input as PermissionCheck;
    const subsessionId = check.sessionId;
    check.sessionId = ctx.sessionManager.getSessionId();
    const blocked = await askForPermission(ctx, check);

    if (!blocked) {
      await addRule(
        ctx.cwd,
        subsessionId,
        "session",
        check.category,
        check.raw,
        check.category === "file" ? (check.op ?? "write") : true,
      );
    }

    return createResumeInput(
      toolName,
      blocked ?? "Tool use allowed. Initiate tool call again to get result",
    );
  }
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
