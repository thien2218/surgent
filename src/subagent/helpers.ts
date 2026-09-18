import type {
  AgentSession,
  ExtensionContext,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { SubsessionResult, SubsessionSnapshot } from "./types.js";
import type { AgentMeta } from "../agent/types.js";
import { createQuestionnaireTool } from "../questionnaire/index.js";
import { enforceToolPermission } from "../permission/index.js";
import { readAgentMode } from "../permission/storage.js";
import webFetchTool from "../web-tools/web-fetch/index.js";
import webSearchTool from "../web-tools/web-search/index.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const DISALLOWED_TOOLS = new Set(["subagent", "call_mcp_tool", "list_mcp_tools"]);

export function createSubsessionBridge(
  ctx: ExtensionContext,
  agentMeta: AgentMeta,
  sessionId: string,
): InlineExtension {
  return {
    name: "subsession-bridge",
    factory(pi) {
      pi.registerTool(createQuestionnaireTool(ctx));
      if (Array.isArray(agentMeta.tools)) {
        if (agentMeta.tools.includes("web_fetch")) pi.registerTool(webFetchTool);
        if (agentMeta.tools.includes("web_search")) pi.registerTool(webSearchTool);
      }

      pi.on("tool_call", async (event) => {
        if (DISALLOWED_TOOLS.has(event.toolName)) {
          return { block: true, reason: "subagent tool is not allowed in subsession" };
        }

        const path = (event.input as { path?: unknown }).path;
        if (PATH_TOOLS.has(event.toolName) && typeof path !== "string") {
          return { block: true, reason: "Explicit path required in subsession" };
        }

        const agentMode = await readAgentMode(ctx.cwd);
        return enforceToolPermission(pi, event, ctx, agentMeta, sessionId, agentMode);
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
