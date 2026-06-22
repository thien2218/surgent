import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { MODE_ENTRY } from "./index.js";
import type { Subsession, SubsessionSnapshot } from "../subsession/types.js";
import { unlink } from "node:fs/promises";
import { Container, Loader, Spacer, TruncatedText } from "@earendil-works/pi-tui";
import { deleteSubsession } from "../subsession/storage.js";
import { getPiPath } from "../utils.js";

async function deleteSessionFile(cwd: string, sessionId?: string) {
  const sessions = await SessionManager.list(cwd, getPiPath("subsessionsDir"));
  const targetSession = sessions.find((session) => sessionId && session.id === sessionId);
  if (!targetSession) {
    return;
  }
  await unlink(targetSession.path);
}

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

  deleteSubsession(subsession.pid, subsession.result.id).catch(() => undefined);
  deleteSessionFile(ctx.cwd, subsession.result.id).catch(() => undefined);

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

  ctx.ui.setWidget(label, (tui, theme) => {
    const widget = new Container() as Container & { dispose?: () => void };
    const loaderLabel =
      snapshot.status === "running"
        ? `running: ${snapshot.activity}`
        : `status: ${snapshot.status}`;
    const loader = new Loader(
      tui,
      (content) => theme.fg("accent", content),
      (content) => theme.fg("muted", content),
      loaderLabel,
    );

    if (snapshot.status !== "running") {
      loader.setIndicator({ frames: ["•"] });
    }

    widget.addChild(loader);
    widget.addChild(new TruncatedText(`${label}: ${snapshot.toolsUsed.length} tool calls`, 1, 0));

    if (recentToolCalls.length === 0) {
      widget.addChild(new TruncatedText(`  └─ ${snapshot.activity}`, 1, 0));
    } else {
      const lastToolCallIndex = recentToolCalls.length - 1;
      for (let toolCallIndex = 0; toolCallIndex < recentToolCalls.length; toolCallIndex += 1) {
        const branchIndicator = toolCallIndex === lastToolCallIndex ? "└─" : "├─";
        const toolCallLine = `  ${branchIndicator} ${recentToolCalls[toolCallIndex]}`;
        widget.addChild(new TruncatedText(toolCallLine, 1, 0));
      }
    }

    widget.addChild(new Spacer(1));
    widget.dispose = () => loader.stop();
    return widget;
  });
}
