import { unlink } from "node:fs/promises";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { cleanupCheckpointStashes } from "../cleanup/stash.js";
import { deleteSubsession } from "../subsession/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { AgentMode } from "../permission/types.js";
import { MODE_ENTRY } from "./index.js";
import type { InteractiveSubsession } from "../subsession/types.js";

async function removeSubsessionKey(filePath: string, sessionId: string) {
  const data = await readJson<Record<string, unknown>>(filePath, {});
  if (!(sessionId in data)) {
    return;
  }
  delete data[sessionId];
  await writeJson(filePath, data);
}

async function deleteSessionFile(cwd: string, sessionId: string) {
  const sessions = await SessionManager.list(cwd);
  const targetSession = sessions.find((session) => session.id === sessionId);
  if (!targetSession) {
    return;
  }
  await unlink(targetSession.path);
}

export async function cleanupSubsession(
  pi: ExtensionAPI,
  cwd: string,
  subsession: InteractiveSubsession,
) {
  await Promise.all([
    deleteSubsession(subsession.parentId, subsession.id),
    removeSubsessionKey(getPiPath("checkpoints", cwd), subsession.id),
    removeSubsessionKey(getPiPath("sessionAgents", cwd), subsession.id),
    deleteSessionFile(cwd, subsession.id),
  ]);

  const sessions = await SessionManager.list(cwd);
  const activeSessionIds = new Set(sessions.map((session) => session.id));
  await cleanupCheckpointStashes(pi, cwd, activeSessionIds);
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

  try {
    await cleanupSubsession(pi, ctx.cwd, subsession);
  } catch {
    ctx.ui.notify("Forwarded plan but failed to clean planner subsession", "warning");
  }

  const modeLabel = mode === "yolo" ? "YOLO" : "assistant";
  ctx.ui.notify(`Forwarded plan to main agent (${modeLabel} next turn).`, "info");
  return true;
}
