import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { MODE_ENTRY } from "./index.js";
import type { InteractiveSubsession, SubsessionSnapshot } from "../subsession/types.js";
import { unlink } from "node:fs/promises";
import { deleteSubsession } from "../subsession/storage.js";
import { getPiPath } from "../utils.js";

async function deleteSessionFile(cwd: string, sessionId: string) {
  const sessions = await SessionManager.list(cwd, getPiPath("subsessionsDir"));
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

  deleteSubsession(subsession.pid, subsession.id).catch(() => undefined);
  deleteSessionFile(ctx.cwd, subsession.id).catch(() => undefined);

  const modeLabel = mode === "yolo" ? "YOLO" : "assistant";
  ctx.ui.notify(`Forwarded plan to main agent (${modeLabel} next turn).`, "info");
  return true;
}

export function renderSnapshotWidget(
  ctx: ExtensionCommandContext,
  label: string,
  snapshot: SubsessionSnapshot,
) {
  const recentToolCalls = snapshot.toolsUsed.slice(-5);
  const lines = ["\n", `${label}: ${snapshot.toolsUsed.length} tool calls`];

  if (recentToolCalls.length === 0) {
    lines.push(` └─ ${snapshot.activity}`);
  } else {
    const lastToolCallIndex = recentToolCalls.length - 1;

    for (let toolCallIndex = 0; toolCallIndex < recentToolCalls.length; toolCallIndex += 1) {
      const branchIndicator = toolCallIndex === lastToolCallIndex ? "└─" : "├─";
      lines.push(` ${branchIndicator} ${recentToolCalls[toolCallIndex]}`);
    }
  }

  lines.push("\n");
  ctx.ui.setWidget(label, lines);
}
