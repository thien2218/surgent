import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { openSubsession } from "./subsession.js";
import { getState } from "../state.js";
import { formatSnapshotText, truncateText } from "./helpers.js";
import type { Cost, SubsessionRequest, SubsessionSnapshot } from "./types.js";
import { renderResultText } from "../utils.js";

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
    description: "Run a task in a separate session using a configured agent and return its result.",
    promptSnippet: "Offload bounded, context-heavy work to configured agents",
    promptGuidelines: [
      "Choose a profile by its description. Batch independent calls and do not duplicate delegated work.",
      "Subagents start with fresh context and cannot see the parent conversation. Supply all needed background in context.",
      "Agent profile instructions are already loaded. Provide task-specific work and constraints, not repeated role responsibilities or rules.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Configured agent profile selected by its description" }),
      task: Type.String({
        description: "Task-specific objective, scope, expected output, and completion criteria",
      }),
      context: Type.String({
        description:
          "Background needed for the task: relevant facts, file paths, decisions, and prior findings. Appended to the task prompt.",
      }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      let snapshot: SubsessionSnapshot | undefined;
      const request: SubsessionRequest = {
        ctx,
        state: getState(pi),
        temporary: true,
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
          await subsession.exec(`Task:\n${params.task}\n\nContext:\n${params.context}`, signal);
        }
        if (subsession.result.status === "error") {
          throw new Error(subsession.result.output || "Subsession failed");
        }
        return {
          content: [{ type: "text", text: subsession.result.output }],
          details: snapshot ?? { status: subsession.result.status, usage: subsession.result.usage },
        };
      } finally {
        // Attach cost on tool_result so failed executions are accounted for too.
        costs.set(toolCallId, subsession.result.usage.cost);
        await subsession.dispose();
      }
    },
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
