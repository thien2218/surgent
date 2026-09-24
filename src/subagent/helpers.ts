import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubsessionResult, SubsessionSnapshot } from "./types.js";

function formatUsageCount(value: number): string {
  if (value >= 10000) {
    return `${Math.trunc(value / 1000)}k`;
  }
  return `${(value / 1000).toFixed(1)}k`;
}

export function formatSnapshotText(snapshot: SubsessionSnapshot): string[] {
  const context = snapshot.contextUsage?.percent;
  const recentToolCalls = snapshot.toolsUsed.slice(-5);
  const lines = [
    `tools_used=${snapshot.usage.toolCalls} | in=${formatUsageCount(snapshot.usage.input)} | out=${formatUsageCount(snapshot.usage.output)} | cost=$${snapshot.usage.cost.toFixed(3)} | ctx=${context === null || context === undefined ? "n/a" : `${context.toFixed(1)}%`}`,
  ];

  for (let toolCallIndex = 0; toolCallIndex < recentToolCalls.length; toolCallIndex += 1) {
    const branchIndicator = toolCallIndex === recentToolCalls.length - 1 ? "└─" : "├─";
    lines.push(`${branchIndicator} ${recentToolCalls[toolCallIndex]}`);
  }

  return lines;
}

export function createErrorResult(message: string): SubsessionResult {
  return {
    status: "error",
    output: message,
    usage: { input: 0, output: 0, toolCalls: 0, cost: 0 },
    toolCounts: {},
  };
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
