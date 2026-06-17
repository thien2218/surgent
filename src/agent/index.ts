import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentsCommandHandler } from "./command.js";
import { IS_SUBSESSION } from "../subsession/index.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: (_args, ctx) => agentsCommandHandler(ctx),
  });

  pi.on("tool_call", (event) => {
    if (!IS_SUBSESSION) return; // Subsession handling

    const subsessionStrippedTools = new Set(["bash", "subagent"]);
    if (subsessionStrippedTools.has(event.toolName)) {
      return {
        block: true,
        reason: `${event.toolName} is not allowed in subsession. Try a different approach.`,
      };
    }

    const pathTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
    const eventWithPath = event as { toolName: string; input: { path?: string } };
    if (!pathTools.has(eventWithPath.toolName)) return;

    const target = eventWithPath.input.path;
    // grep/find/ls without explicit path would search cwd implicitly — block it
    if (!target) {
      return { block: true, reason: "Explicit path required in subsession." };
    }
  });
}
