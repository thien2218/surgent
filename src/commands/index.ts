import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { planCommandHandler } from "./plan.js";

export const MODE_ENTRY = "commands/mode";

export default function commandsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("plan", {
    description: "Run planner in a reusable planning subsession",
    handler: (args, ctx) => planCommandHandler(pi, args, ctx),
  });
}
