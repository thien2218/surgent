import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { planCommandHandler } from "./plan.js";
import { reviewCommandHandler } from "./review.js";
import { emitInteractionHandoff } from "../subsession/index.js";

export const MODE_ENTRY = "commands/mode";

export default function commandsExtension(pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Run planner in a reusable planning subsession",
    handler: (args, ctx) => planCommandHandler(pi, args, ctx),
  });

  pi.registerCommand("review", {
    description: "Run reviewer in a reusable review subsession",
    handler: (args, ctx) => reviewCommandHandler(pi, args, ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "questionnaire") {
      return emitInteractionHandoff(event.toolName, event.input, ctx);
    }
  });
}
