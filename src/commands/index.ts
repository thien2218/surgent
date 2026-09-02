import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { planCommandHandler } from "./plan.js";
import { reviewCommandHandler } from "./review.js";

export const MODE_ENTRY = "commands/mode";

export default function commandsExtension(pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Create and save an implementation plan",
    handler: (args, ctx) => planCommandHandler(pi, args, ctx),
  });

  pi.registerCommand("review", {
    description: "Create and save a code review",
    handler: (args, ctx) => reviewCommandHandler(pi, args, ctx),
  });
}
