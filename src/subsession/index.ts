import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { openSubsession } from "./execute.js";
import type { SubsessionRequest } from "./types.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Delegate a focused task to a configured agent.",
    promptSnippet: "Delegate focused tasks to a configured agent",
    parameters: Type.Object({
      agent: Type.String({ description: "Configured agent profile name" }),
      task: Type.String({ description: "Task for the subagent" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const request: SubsessionRequest = {
        ctx,
        label: "subagent",
        agent: params.agent,
        signal,
        onSnapshot: (snapshot) => {
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
      };

      const subsession = await openSubsession(request);
      try {
        if (subsession.result.status !== "error") {
          await subsession.exec(params.task, signal);
        }
        return {
          content: [
            {
              type: "text",
              text: subsession.result.output || `Subagent ${subsession.result.status}`,
            },
          ],
          details: { status: subsession.result.status, usage: subsession.result.usage },
        };
      } finally {
        await subsession.dispose();
      }
    },
  });
}

export { renderSnapshotWidget } from "./helpers.js";
export { openSubsession };
