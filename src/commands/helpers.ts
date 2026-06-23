import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { MODE_ENTRY } from "./index.js";
import type { Subsession } from "../subsession/types.js";
import { terminateSubsession } from "../subsession/storage.js";

export async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mode: AgentMode,
  subsession: Subsession,
): Promise<boolean> {
  const normalizedOutput = subsession.result.output.trim();
  if (!normalizedOutput) {
    ctx.ui.notify("No planner output to forward", "warning");
    return false;
  }

  pi.appendEntry<{ mode: AgentMode }>(MODE_ENTRY, { mode });

  try {
    pi.sendUserMessage(normalizedOutput);
  } catch {
    ctx.ui.notify("Failed to forward plan", "error");
    return false;
  }

  const modeLabel = mode === "yolo" ? "YOLO" : "assistant";
  ctx.ui.notify(`Forwarded plan to main agent (${modeLabel} next turn).`, "info");

  terminateSubsession(ctx.cwd, subsession.result.id!).catch(() => undefined);
  return true;
}
