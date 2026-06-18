import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { MODE_ENTRY } from "./index.js";
import type { InteractiveSubsession } from "../subsession/types.js";
import { unlink } from "node:fs/promises";
import { deleteSubsession } from "../subsession/storage.js";

async function deleteSessionFile(cwd: string, sessionId: string) {
  const sessions = await SessionManager.list(cwd);
  const targetSession = sessions.find((session) => session.id === sessionId);
  if (!targetSession) {
    return;
  }
  await unlink(targetSession.path);
}

export async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mode: AgentMode,
  subsession: InteractiveSubsession,
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

  deleteSubsession(subsession.parentId, subsession.id).catch(() => undefined);
  deleteSessionFile(ctx.cwd, subsession.id).catch(() => undefined);

  const modeLabel = mode === "yolo" ? "YOLO" : "assistant";
  ctx.ui.notify(`Forwarded plan to main agent (${modeLabel} next turn).`, "info");
  return true;
}
