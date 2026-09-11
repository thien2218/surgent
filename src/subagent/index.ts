import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { openSubsession } from "./subsession.js";
import { formatSnapshotText } from "./helpers.js";
import type { SubsessionRequest, SubsessionSnapshot } from "./types.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate bounded, self-contained work to a configured agent. Choose by agent description, provide complete context and expected output, batch independent calls, and do not duplicate delegated work.",
    promptSnippet: "Offload bounded, context-heavy work to configured agents",
    parameters: Type.Object({
      agent: Type.String({ description: "Configured agent profile selected by its description" }),
      task: Type.String({
        description:
          "Standalone task with outcome, scope, known context, constraints, expected output, and done condition",
      }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      let snapshot: SubsessionSnapshot | undefined;
      const request: SubsessionRequest = {
        ctx,
        label: "subagent",
        agent: params.agent,
        signal,
        onSnapshot: (nextSnapshot) => {
          snapshot = nextSnapshot;
          onUpdate?.({ content: [], details: nextSnapshot });
        },
      };

      const subsession = await openSubsession(request);
      try {
        if (subsession.result.status !== "error") {
          await subsession.exec(params.task, signal);
        }
        const details = snapshot ?? {
          status: subsession.result.status,
          usage: subsession.result.usage,
        };

        return {
          content: [
            {
              type: "text",
              text: subsession.result.output || subsession.result.status,
            },
          ],
          details: subsession.result.evidence
            ? { ...details, evidence: subsession.result.evidence }
            : details,
        };
      } finally {
        await subsession.dispose();
      }
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", "subagent")} ${theme.fg("dim", `"${args.task}"`)}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme, context) {
      const output = result.content[0];
      if (!isPartial) {
        return new Text("\n" + (output?.type === "text" ? output.text : ""), 0, 0);
      }

      const snapshot = result.details as SubsessionSnapshot | undefined;
      if (!snapshot?.toolsUsed) {
        return new Text("\n" + theme.fg("dim", `Subagent ${context.args.agent}: starting`), 0, 0);
      }

      const lines = [
        theme.fg(
          snapshot.status === "error" ? "error" : "accent",
          `${context.args.agent}: ${snapshot.status}`,
        ),
        ...formatSnapshotText(snapshot).map((line) => theme.fg("dim", `  ${line}`)),
      ];
      return new Text("\n" + lines.join("\n"), 0, 0);
    },
  });
}
