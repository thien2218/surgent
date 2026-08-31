import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentMeta } from "../agent/types.js";
import { createQuestionnaireTool } from "../questionnaire/index.js";
import { enforceToolPermission } from "../permission/index.js";
import { findRecentModeOverride } from "../permission/helpers.js";
import { readAgentMode } from "../permission/storage.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export function createSubsessionBridge(
  context: ExtensionContext,
  agentMeta: AgentMeta,
  sessionId: string,
): InlineExtension {
  return {
    name: "subsession-bridge",
    factory(pi) {
      pi.registerTool(createQuestionnaireTool(context));

      pi.on("tool_call", async (event) => {
        if (event.toolName === "subagent") {
          return { block: true, reason: "subagent tool is not allowed in subsession" };
        }

        const path = (event.input as { path?: unknown }).path;
        if (PATH_TOOLS.has(event.toolName) && typeof path !== "string") {
          return { block: true, reason: "Explicit path required in subsession" };
        }

        const mode =
          findRecentModeOverride(context.sessionManager.getEntries()) ??
          (await readAgentMode(context.cwd));

        return enforceToolPermission(event, context, agentMeta, sessionId, mode === "yolo");
      });
    },
  };
}
