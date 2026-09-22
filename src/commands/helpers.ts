import { unlink, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Subsession, SubsessionRequest } from "../subagent/types.js";
import { terminateSubsession } from "../subagent/storage.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subagent/types.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { getPiPath, isMissingFileError, isUuidv7, openInEditor, readJson } from "../utils.js";
import { openSubsession } from "../subagent/subsession.js";
import { renderSnapshotWidget, showPlanUi } from "./render.js";
import type { CommandInput } from "./types.js";

async function savePlanOutput(
  ctx: ExtensionCommandContext,
  subsession: Subsession,
): Promise<string | null> {
  if (!subsession.result.id) {
    ctx.ui.notify("Failed to save plan: missing subsession ID", "error");
    return null;
  }

  const outputPath = getPiPath("plans", ctx.cwd, `${subsession.result.id}.md`);

  try {
    await writeFile(outputPath, `${subsession.result.output.trimEnd()}\n`, "utf8");
    return outputPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to save plan: ${message}`, "error");
    return null;
  }
}

async function discardSubsession(
  ctx: ExtensionCommandContext,
  subsession: Subsession,
  outputPath: string | null,
) {
  if (outputPath) {
    try {
      await unlink(outputPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to delete ${subsession.label}: ${message}`, "error");
      }
    }
  }

  const subsessionId = subsession.result.id;
  if (!subsessionId) return;
  terminateSubsession(ctx.cwd, subsessionId).catch(() => undefined);
}

async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
): Promise<boolean> {
  const normalizedOutput = subsession.result.output.trim();
  if (!normalizedOutput) {
    ctx.ui.notify(`No ${subsession.label} to forward`, "warning");
    return false;
  }
  try {
    pi.sendUserMessage(normalizedOutput);
  } catch {
    ctx.ui.notify(`Failed to forward ${subsession.label}`, "error");
    return false;
  }
  return true;
}

export async function runPlanLoop(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
) {
  try {
    const outputPath = await savePlanOutput(ctx, subsession);
    while (true) {
      ctx.ui.setWidget("planner", undefined);
      const action = await showPlanUi(ctx, subsession.result.output, outputPath);

      if (action.kind === "save") {
        ctx.ui.notify(
          `Saved plan to ${outputPath}. Resume with '/plan ${subsession.result.id}'`,
          "info",
        );
        return;
      }
      if (action.kind === "discard") {
        discardSubsession(ctx, subsession, outputPath);
        return;
      }

      if (action.kind === "open") {
        if (outputPath) await openInEditor(ctx, outputPath);
      } else if (action.kind === "forward") {
        if (await forwardAction(pi, ctx, subsession)) {
          discardSubsession(ctx, subsession, outputPath);
          return;
        }
      } else {
        await subsession.exec(action.feedback);
      }
    }
  } finally {
    await subsession.dispose();
    ctx.ui.setWidget("planner", undefined);
  }
}

export async function getPlanPreviews(
  cwd: string,
  sessionId: string,
): Promise<{ subsessionId: string; title: string }[]> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", cwd), {});
  const previews: { subsessionId: string; title: string }[] = [];

  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (metadata.label === "plan" && metadata.pid === sessionId) {
      previews.push({ subsessionId, title: metadata.title });
    }
  }

  return previews;
}

export async function getPlanCompletions(cwd: string, sessionId: string, prefix: string) {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const items = (await getPlanPreviews(cwd, sessionId))
    .filter(
      ({ subsessionId, title }) =>
        subsessionId.startsWith(normalizedPrefix) || title.toLowerCase().includes(normalizedPrefix),
    )
    .map(({ subsessionId, title }) => ({ value: subsessionId, label: title }));
  return items.length > 0 ? items : null;
}

async function pickPlanId(ctx: ExtensionContext): Promise<string | null> {
  const previews = await getPlanPreviews(ctx.cwd, ctx.sessionManager.getSessionId());
  if (previews.length === 0) {
    ctx.ui.notify("No stored plan sessions", "warning");
    return null;
  }

  const items: SelectEntry<{ subsessionId: string }>[] = previews.map((preview) => ({
    value: preview.subsessionId,
    label: preview.title,
    data: { subsessionId: preview.subsessionId },
  }));

  return ctx.ui.custom<string | null>((_tui, theme, _keybindings, done) => {
    const selectList = new ExtendedSelectList<{ subsessionId: string }>(theme, {
      title: "Reopen plan session",
      items,
      maxVisibleRows: 12,
    });

    selectList.onCancel = () => done(null);
    selectList.onSelect = (item) => done(item.data?.subsessionId ?? null);
    selectList.onDelete = (item) => {
      const subsessionId = item.data?.subsessionId;
      if (!subsessionId) return;
      terminateSubsession(ctx.cwd, subsessionId)
        .then(() => ctx.ui.notify("Deleted plan session", "info"))
        .catch(() => ctx.ui.notify("Failed to delete plan session", "error"));
    };

    return selectList;
  });
}

export async function resolvePlan(
  ctx: ExtensionCommandContext,
  input: CommandInput,
): Promise<Subsession | null> {
  let prompt = "";
  const request: SubsessionRequest = {
    ctx,
    label: "plan",
    agent: "planner",
    onSnapshot: (snapshot) => renderSnapshotWidget(ctx, "planner", snapshot),
  };

  if (input.kind === "prompt") {
    prompt = input.prompt;
  } else if (input.kind === "resume") {
    request.id = input.subsessionId;
  } else {
    const selectedSubsessionId = await pickPlanId(ctx);
    if (!selectedSubsessionId) return null;
    request.id = selectedSubsessionId;
  }

  const subsession = await openSubsession(request);
  if (!request.id && subsession.result.status !== "error") {
    await subsession.exec(prompt);
  }
  if (!subsession.result.id) {
    await subsession.dispose();
    ctx.ui.notify(subsession.result.output || "Failed to initiate subsession", "error");
    return null;
  }

  return subsession;
}

export function parseCommandInput(args: string): CommandInput {
  const normalized = args.trim();
  if (!normalized) {
    return { kind: "list" };
  }
  if (isUuidv7(normalized)) {
    return { kind: "resume", subsessionId: normalized };
  }
  return { kind: "prompt", prompt: normalized };
}
