import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import runSubsession from "./execute.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate a focused task to a specialist agent.",
    parameters: Type.Object({
      agent: Type.String({ description: "Configured agent profile name" }),
      task: Type.String({ description: "Task for the subagent" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const subsession = await runSubsession(
        { ctx, label: "other", agent: params.agent, input: params.task, signal },
        (snapshot) => {
          onUpdate?.({
            content: [
              {
                type: "text",
                text: `Subagent ${snapshot.id || params.agent}: ${snapshot.status}`,
              },
            ],
            details: snapshot,
          });
        },
      );

      try {
        return {
          content: [
            {
              type: "text",
              text: subsession.result.output || `Subagent ${subsession.result.status}`,
            },
          ],
          details: {
            id: subsession.result.id,
            status: subsession.result.status,
            usage: subsession.result.usage,
          },
        };
      } finally {
        subsession.dispose();
      }
    },
  });
}

export { renderSnapshotWidget } from "./helpers.js";
export { runSubsession };
