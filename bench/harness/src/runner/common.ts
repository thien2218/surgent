import { executeCommand } from "../util/exec.js";
import {
  BenchmarkAgent,
  TurnRunStatus,
  type NormalizedTurnTelemetry,
  type PromptTurn,
  type RunnerSessionState,
} from "../types.js";

export interface RunnerTurnCommand {
  commandName: string;
  commandArgs: string[];
  cwdPath: string;
  timeoutMs: number;
  stdinText: string | null;
  envVars: NodeJS.ProcessEnv | null;
}

export interface RunnerTurnResult {
  telemetry: NormalizedTurnTelemetry;
  discoveredSessionId: string | null;
}

export async function runTurnCommand(
  sessionState: RunnerSessionState,
  promptTurn: PromptTurn,
  command: RunnerTurnCommand,
): Promise<RunnerTurnResult> {
  const startedAtDate = new Date();
  const commandResult = await executeCommand({
    commandName: command.commandName,
    commandArgs: command.commandArgs,
    cwdPath: command.cwdPath,
    timeoutMs: command.timeoutMs,
    stdinText: command.stdinText,
    envVars: command.envVars,
  });
  const finishedAtDate = new Date();

  const parsedTelemetry = parseStructuredTelemetry(commandResult.stdout, commandResult.stderr);

  let status = TurnRunStatus.Ok;
  if (commandResult.timedOut) {
    status = TurnRunStatus.Timeout;
  } else if (commandResult.exitCode !== 0) {
    status = TurnRunStatus.Error;
  }

  const telemetry: NormalizedTurnTelemetry = {
    taskId: sessionState.taskId,
    agent: sessionState.agent,
    turnId: promptTurn.id,
    prompt: promptTurn.prompt,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: commandResult.durationMs,
    status,
    exitCode: commandResult.exitCode,
    tokensIn: parsedTelemetry.tokensIn,
    tokensOut: parsedTelemetry.tokensOut,
    tokensCached: parsedTelemetry.tokensCached,
    contextUsedPct: parsedTelemetry.contextUsedPct,
    toolCalls: parsedTelemetry.toolCalls,
    stopReason: status === TurnRunStatus.Timeout ? "timeout" : parsedTelemetry.stopReason,
    rawStdout: commandResult.stdout,
    rawStderr: commandResult.stderr,
  };

  return {
    telemetry,
    discoveredSessionId: parsedTelemetry.sessionId,
  };
}

interface ParsedStructuredTelemetry {
  sessionId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCached: number | null;
  contextUsedPct: number | null;
  toolCalls: number | null;
  stopReason: string | null;
}

function parseStructuredTelemetry(stdoutOutput: string, stderrOutput: string): ParsedStructuredTelemetry {
  const events: Record<string, unknown>[] = [];
  const stdoutLines = stdoutOutput.split(/\r?\n/);

  for (const stdoutLine of stdoutLines) {
    const trimmedLine = stdoutLine.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    try {
      const parsedLine = JSON.parse(trimmedLine);
      if (typeof parsedLine === "object" && parsedLine !== null && !Array.isArray(parsedLine)) {
        events.push(parsedLine as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  let discoveredSessionId: string | null = null;
  let stopReason: string | null = null;
  let contextUsedPct: number | null = null;
  let tokensCached: number | null = null;
  let sawAssistantMessage = false;
  let toolCallCount = 0;

  let tokensInSeen = false;
  let tokensOutSeen = false;
  let tokensInTotal = 0;
  let tokensOutTotal = 0;

  for (const event of events) {
    const eventType = event["type"];

    if (eventType === "session") {
      const maybeSessionId = event["id"];
      if (typeof maybeSessionId === "string" && maybeSessionId.trim().length > 0) {
        discoveredSessionId = maybeSessionId;
      }
    }

    if (contextUsedPct === null) {
      contextUsedPct = findNumericField(event, new Set(["contextUsedPct", "context_used_pct", "contextPercent", "contextUsagePct"]));
    }

    if (tokensCached === null) {
      tokensCached = findNumericField(event, new Set(["tokensCached", "cached", "cache", "cached_tokens", "cacheRead"]));
    }

    if (eventType !== "message_end") {
      continue;
    }

    const messageValue = event["message"];
    if (typeof messageValue !== "object" || messageValue === null || Array.isArray(messageValue)) {
      continue;
    }

    const messageObject = messageValue as Record<string, unknown>;
    if (messageObject["role"] !== "assistant") {
      continue;
    }

    sawAssistantMessage = true;

    const usageValue = messageObject["usage"];
    if (typeof usageValue === "object" && usageValue !== null && !Array.isArray(usageValue)) {
      const usageObject = usageValue as Record<string, unknown>;

      const usageInput = usageObject["input"];
      if (typeof usageInput === "number" && Number.isFinite(usageInput)) {
        tokensInSeen = true;
        tokensInTotal += usageInput;
      }

      const usageOutput = usageObject["output"];
      if (typeof usageOutput === "number" && Number.isFinite(usageOutput)) {
        tokensOutSeen = true;
        tokensOutTotal += usageOutput;
      }

      if (tokensCached === null) {
        const usageCached = findNumericField(usageObject, new Set(["cached", "cache", "cached_tokens", "cacheRead"]));
        if (usageCached !== null) {
          tokensCached = usageCached;
        }
      }
    }

    const maybeStopReason = messageObject["stopReason"];
    if (typeof maybeStopReason === "string" && maybeStopReason.trim().length > 0) {
      stopReason = maybeStopReason;
    }

    const contentValue = messageObject["content"];
    if (!Array.isArray(contentValue)) {
      continue;
    }

    for (const contentPart of contentValue) {
      if (typeof contentPart !== "object" || contentPart === null || Array.isArray(contentPart)) {
        continue;
      }

      const contentPartObject = contentPart as Record<string, unknown>;
      if (contentPartObject["type"] === "toolCall") {
        toolCallCount += 1;
      }
    }
  }

  const fallbackText = `${stdoutOutput}\n${stderrOutput}`;

  if (contextUsedPct === null) {
    contextUsedPct = parseFirstNumberByPattern(fallbackText, [
      /context\s*(?:used|usage)?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
      /context\s*(\d+(?:\.\d+)?)\s*%/i,
    ]);
  }

  if (tokensCached === null) {
    tokensCached = parseFirstNumberByPattern(fallbackText, [/cached\s*tokens?\s*[:=]\s*(\d+)/i]);
  }

  if (!stopReason) {
    const fallbackStopReason = parseFirstStringByPattern(fallbackText, [/stop\s*reason\s*[:=]\s*([^\n\r]+)/i]);
    if (fallbackStopReason) {
      stopReason = fallbackStopReason;
    }
  }

  return {
    sessionId: discoveredSessionId,
    tokensIn: tokensInSeen ? tokensInTotal : null,
    tokensOut: tokensOutSeen ? tokensOutTotal : null,
    tokensCached,
    contextUsedPct,
    toolCalls: sawAssistantMessage ? toolCallCount : null,
    stopReason,
  };
}

function findNumericField(value: unknown, candidateKeys: Set<string>): number | null {
  const queue: unknown[] = [value];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const currentValue = queue.shift();
    if (currentValue === undefined || currentValue === null) {
      continue;
    }
    if (visited.has(currentValue)) {
      continue;
    }
    visited.add(currentValue);

    if (Array.isArray(currentValue)) {
      for (const arrayItem of currentValue) {
        queue.push(arrayItem);
      }
      continue;
    }

    if (typeof currentValue !== "object") {
      continue;
    }

    const objectValue = currentValue as Record<string, unknown>;
    for (const [objectKey, objectMember] of Object.entries(objectValue)) {
      if (candidateKeys.has(objectKey) && typeof objectMember === "number" && Number.isFinite(objectMember)) {
        return objectMember;
      }
      queue.push(objectMember);
    }
  }

  return null;
}

function parseFirstNumberByPattern(inputText: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = inputText.match(pattern);
    if (!match || !match[1]) {
      continue;
    }

    const parsedValue = Number(match[1]);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

function parseFirstStringByPattern(inputText: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = inputText.match(pattern);
    if (!match || !match[1]) {
      continue;
    }

    const parsedValue = match[1].trim();
    if (parsedValue.length > 0) {
      return parsedValue;
    }
  }

  return null;
}

export function formatNullableMetric(value: number | string | null): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return value;
}

export function isSupportedAgent(agent: string): agent is `${BenchmarkAgent}` {
  return agent === BenchmarkAgent.Surgent || agent === BenchmarkAgent.Copilot;
}
