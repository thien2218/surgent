import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentsCommandHandler } from "./command.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("agent", {
    description: "List, create, edit, and switch agents",
    handler: (_args, ctx) => agentsCommandHandler(ctx),
  });
}
