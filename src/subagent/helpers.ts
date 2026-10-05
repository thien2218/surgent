import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubsessionResult, SubsessionSnapshot } from "./types.js";
import { Text } from "@earendil-works/pi-tui";

function formatUsageCount(value: number): string {
  const divided = value >= 10000 ? Math.trunc(value / 1000) : (value / 1000).toFixed(1);
  return `${divided}k`;
}

export function formatSnapshotText(snapshot: SubsessionSnapshot, width: number): string[] {
  const context = snapshot.contextUsage?.percent;
  const recentToolCalls = snapshot.toolsUsed.slice(-5);
  const lines = [
    `  tools_used=${snapshot.usage.toolCalls} | in=${formatUsageCount(snapshot.usage.input)} | out=${formatUsageCount(snapshot.usage.output)} | cost=$${snapshot.usage.cost.total.toFixed(3)} | ctx=${context === null || context === undefined ? "n/a" : `${context.toFixed(1)}%`}`,
  ];

  for (let toolCallIndex = 0; toolCallIndex < recentToolCalls.length; toolCallIndex += 1) {
    const branchIndicator = toolCallIndex === recentToolCalls.length - 1 ? "└─" : "├─";
    lines.push(truncateText(`  ${branchIndicator} ${recentToolCalls[toolCallIndex]}`, width - 3));
  }

  return lines.flatMap((line) => new Text(line, 0, 0).render(width));
}

export function createErrorResult(message: string): SubsessionResult {
  return {
    status: "error",
    output: message,
    usage: {
      input: 0,
      output: 0,
      toolCalls: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
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

export function truncateText(text: string, length: number) {
  const maxLength = Math.max(1, length);
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}
