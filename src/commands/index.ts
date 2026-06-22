import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { planCommandHandler } from "./plan.js";
import { IS_SUBSESSION } from "../subsession/index.js";

export const MODE_ENTRY = "commands/mode";
const HANDOFF_PREFIX = "subsession_handoff:";

export default function commandsExtension(pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Run planner in a reusable planning subsession",
    handler: (args, ctx) => planCommandHandler(pi, args, ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (ctx.hasUI || !IS_SUBSESSION || event.toolName !== "questionnaire") {
      return;
    }
    const serializedRequest = JSON.stringify({ toolName: event.toolName, input: event.input });
    process.stderr.write(`${HANDOFF_PREFIX}${serializedRequest}\n`);
    ctx.abort();
    return { block: true, reason: "Interactive tool call requires handoff to parent session UI." };
  });
}
