import { existsSync } from "node:fs";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { Interaction, SubsessionResult } from "./types.js";
import { IS_SUBSESSION } from "./index.js";

const MARKDOWN_HEADING_PATTERN = /^\s*#\s+(.+?)\s*$/m;
const HANDOFF_PREFIX = "subsession_handoff:";

export function emitInteractionHandoff(event: ToolCallEvent, ctx: ExtensionContext) {
  if (ctx.hasUI || !IS_SUBSESSION) {
    return;
  }
  const serializedRequest = JSON.stringify({ toolName: event.toolName, input: event.input });
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

export function createResumeInput(request: Interaction, result: unknown): string {
  let serialized = "{}";
  try {
    serialized = JSON.stringify(result);
  } catch {
    serialized = JSON.stringify({ cancelled: true, reason: "Failed to serialize result" });
  }

  return [
    "[RESUMED_TOOL_RESULT]",
    `toolName: ${request.toolName}`,
    `result: ${serialized}`,
    "[/RESUMED_TOOL_RESULT]",
  ].join("\n");
}

export function extractSubsessionTitle(output: string): string | undefined {
  const headingMatch = output.match(MARKDOWN_HEADING_PATTERN);
  if (!headingMatch) {
    return;
  }

  const headingText = headingMatch[1]?.trim();
  if (!headingText) {
    return;
  }

  const separatorIndex = headingText.indexOf(":");
  const titleText =
    separatorIndex >= 0 ? headingText.slice(separatorIndex + 1).trim() : headingText;

  if (!titleText) {
    return;
  }
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
  return { status: "error", output: message, toolCounts: {} };
}
