import type { AgentSession, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { RuntimeConfig, SubsessionResult, SubsessionSnapshot } from "./types.js";
import { STATE_EVENT, type AppState } from "../state.js";
import type { AgentMode } from "../agent/types.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export function createSubsessionBridge(runtime: RuntimeConfig, state: AppState): InlineExtension {
  return {
    name: "subsession-bridge",
    factory(pi) {
      const unsubscribe = pi.events.on(STATE_EVENT, (reply) => {
        if (typeof reply !== "function") return;
        reply({
          getAgent: () => ({
            name: runtime.agent,
            meta: runtime.meta,
            body: runtime.systemPrompt,
            filePath: "", // Runtime profiles do not have a source file.
          }),
          getMode: () => state.getMode(),
          setMode: (mode: AgentMode) => state.setMode(mode),
          dispose: () => unsubscribe(),
        } satisfies AppState);
      });
      pi.on("session_shutdown", () => unsubscribe());

      pi.on("tool_call", async (event) => {
        const path = (event.input as { path?: unknown }).path;
        if (PATH_TOOLS.has(event.toolName) && typeof path !== "string") {
          return { block: true, reason: "Explicit path required in subsession" };
        }
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
