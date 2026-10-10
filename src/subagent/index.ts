import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { openSubsession } from "./subsession.js";
import { getState } from "../state.js";
import { formatSnapshotText, truncateText } from "./helpers.js";
import type { Cost, SubsessionRequest, SubsessionSnapshot } from "./types.js";
import { getPiPath, renderResultText } from "../utils.js";

export default function (pi: ExtensionAPI) {
  const costs = new Map<string, Cost>();

  pi.on("tool_result", (event) => {
    if (event.toolName !== "subagent") return;
    const cost = costs.get(event.toolCallId);
    costs.delete(event.toolCallId);
    if (!cost) return;
    // Parent model usage already accounts for tokens consumed from the result.
    return { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost } };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    exposure: "model-only",
    description:
      "Run or resume a task in a separate session using a configured agent and return its result and session ID.",
    promptSnippet: "Offload bounded, context-heavy work to configured agents",
    promptGuidelines: [
      "Choose a profile by its description. Batch independent calls and do not duplicate delegated work.",
      "New subagents start with fresh context and cannot see the parent conversation. Include all needed background in the task.",
      "Reuse the returned session ID for follow-up tasks. Resumed subagents retain their conversation and configured profile.",
      "Agent profile instructions are already loaded. Provide task-specific work and constraints, not repeated role responsibilities or rules.",
    ],
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({
          description:
            "Session ID from a previous subagent result to resume; omit to start a new session",
        }),
      ),
      agent: Type.String({ description: "Configured agent profile selected by its description" }),
      task: Type.String({
        description:
          "Task-specific objective, scope, needed background, expected output, and completion criteria",
      }),
    }),
    execute: (toolCallId, params, signal, onUpdate, ctx) => withFileMutationQueue(getPiPath("subsessionsDir", ctx.cwd, params.id ?? toolCallId), async () => {
      let snapshot: SubsessionSnapshot | undefined;
      const request: SubsessionRequest = {
        ctx,
        state: getState(pi),
        id: params.id,
        agent: params.agent,
        signal,
        onSnapshot: (nextSnapshot) => {
          snapshot = nextSnapshot;
          onUpdate?.({ content: [], details: nextSnapshot });
        },
      };

      const subsession = await openSubsession(request);
      const previousCost = { ...subsession.result.usage.cost };
      try {
        if (subsession.result.status !== "error") {
          await subsession.exec(params.task, signal);
        }
        if (subsession.result.status === "error") {
          let message = subsession.result.output || "Subsession failed";
          if (subsession.result.id) message += `\n\nSubagent ID: ${subsession.result.id}`;
          throw new Error(message);
        }
        return {
          content: [
            {
              type: "text",
              text: `Subagent ID: ${subsession.result.id}\n\n${subsession.result.output}`,
            },
          ],
          details: snapshot ?? { status: subsession.result.status, usage: subsession.result.usage },
        };
      } finally {
        // Attach cost on tool_result so failed executions are accounted for too.
        const cost = subsession.result.usage.cost;
        costs.set(toolCallId, {
          input: cost.input - previousCost.input,
          output: cost.output - previousCost.output,
          cacheRead: cost.cacheRead - previousCost.cacheRead,
          cacheWrite: cost.cacheWrite - previousCost.cacheWrite,
          total: cost.total - previousCost.total,
        });
        await subsession.dispose();
      }
    }),
    renderCall(args, theme) {
      return {
        render(width: number) {
          return new Text(
            `${theme.fg("toolTitle", "subagent")} ${theme.fg("accent", args.agent)} ${theme.fg("dim", `"${truncateText(args.task ?? "", width * 4 - 50)}"`)}\n`,
            0,
            0,
          ).render(width);
        },
        invalidate() {},
      };
    },
    renderResult(result, { expanded, isPartial }, theme, ctx) {
      if (!isPartial) {
        const output = result.content[0];
        const text = output?.type === "text" ? output.text : "";
        return renderResultText(text, theme, expanded);
      }

      const snapshot = result.details as SubsessionSnapshot | undefined;
      if (!snapshot?.toolsUsed) {
        return new Text(theme.fg("toolOutput", `Subagent ${ctx.args.agent}: starting`), 0, 0);
      }

      return {
        render(width: number) {
          const heading = new Text(theme.bold(`${ctx.args.agent}: ${snapshot.status}`), 0, 0);
          const lines = [...heading.render(width), ...formatSnapshotText(snapshot, width)];
          return lines.map((line) => theme.fg("toolOutput", line));
        },
        invalidate() {},
      };
    },
  });

  pi.on("session_shutdown", () => costs.clear());
}
