import { unlink, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Subsession, SubsessionRequest } from "../subagent/types.js";
import { terminateSubsession } from "../subagent/storage.js";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subagent/types.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { getPiPath, isMissingFileError, isUuidv7, openInEditor, readJson } from "../utils.js";
import { renderSnapshotWidget } from "../subagent/helpers.js";
import { openSubsession } from "../subagent/subsession.js";
import type { CommandInput, LoopAction, LoopConfig } from "./types.js";

async function saveSubsessionOutput(
  ctx: ExtensionCommandContext,
  subsession: Subsession,
): Promise<string | null> {
  if (!subsession.result.id) {
    ctx.ui.notify(`Failed to save ${subsession.label}: missing subsession ID`, "error");
    return null;
  }

  const outputPath = getPiPath(
    subsession.label === "plan" ? "plans" : "reviews",
    ctx.cwd,
    `${subsession.result.id}.md`,
  );

  try {
    await writeFile(outputPath, `${subsession.result.output.trimEnd()}\n`, "utf8");
    ctx.ui.notify(`Saved ${subsession.label} to ${outputPath}`, "info");
    return outputPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to save ${subsession.label}: ${message}`, "error");
    return null;
  }
}

function mapActionResult(result: ActionSelectResult): LoopAction | null {
  if (result.type === "input") {
    return { kind: "feedback", feedback: result.value };
  }
  if (result.value === "forward") {
    return { kind: "forward" };
  }
  if (result.value === "open") {
    return { kind: "open" };
  }
  if (result.value === "save") {
    return { kind: "save" };
  }
  return null;
}

function discardSubsession(ctx: ExtensionCommandContext, subsession: Subsession) {
  const subsessionId = subsession.result.id;
  if (!subsessionId) return;
  terminateSubsession(ctx.cwd, subsessionId).catch(() => undefined);
}

async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
  outputPath: string | null,
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

  discardSubsession(ctx, subsession);
  return true;
}

async function showActionUi(
  ctx: ExtensionCommandContext,
  output: string,
  config: LoopConfig,
  outputPath: string | null,
): Promise<LoopAction | null> {
  const markdown = output.trim().length > 0 ? output : `_No ${config.agent} output yet._`;
  const options: ActionSelectOption[] = [{ value: "forward", label: config.submitText }];
  if (outputPath) {
    options.push({ value: "open", label: `Open ${config.name} in external editor` });
  }
  options.push({ value: "save", label: "Save and exit" });

  return ctx.ui.custom<LoopAction | null>((tui, theme, keybindings, done) => {
    const actionSelectList = new ActionSelectList(tui, keybindings, theme, {
      title: "What should surgent do next?",
      options,
      placeholder: `Feedback for ${config.agent} agent`,
    });
    actionSelectList.onSubmit = (result) => done(mapActionResult(result));
    actionSelectList.onCancel = () => done({ kind: "discard" });

    const scrollableView = new ScrollableView(tui, theme, { markdown, input: actionSelectList });
    scrollableView.focused = true;
    scrollableView.onCancel = () => done({ kind: "discard" });

    return scrollableView;
  });
}

export async function runSubsessionLoop(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
  config: LoopConfig,
) {
  try {
    const outputPath = await saveSubsessionOutput(ctx, subsession);
    while (true) {
      ctx.ui.setWidget(config.agent, undefined);
      const action = await showActionUi(ctx, subsession.result.output, config, outputPath);

      if (!action || action.kind === "save") return;
      if (action.kind === "open") {
        if (outputPath) await openInEditor(ctx, outputPath);
        continue;
      }
      if (action.kind === "discard") {
        discardSubsession(ctx, subsession);
        return;
      }
      if (action.kind === "forward") {
        const forwarded = await forwardAction(pi, ctx, subsession, outputPath);
        if (forwarded) return;
        continue;
      }

      await subsession.exec(action.feedback);
    }
  } finally {
    await subsession.dispose();
    ctx.ui.setWidget(config.agent, undefined);
  }
}

export async function pickSubsessionId(
  ctx: ExtensionContext,
  label: "plan" | "review",
): Promise<string | null> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", ctx.cwd), {});
  const previews: { subsessionId: string; title: string }[] = [];

  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (metadata.label === label && metadata.pid === ctx.sessionManager.getSessionId()) {
      previews.push({ subsessionId, title: metadata.title });
    }
  }

  if (previews.length === 0) {
    ctx.ui.notify(`No stored ${label} sessions`, "warning");
    return null;
  }

  const items: SelectEntry<{ subsessionId: string }>[] = previews.map((preview) => ({
    value: preview.subsessionId,
    label: preview.title,
    data: { subsessionId: preview.subsessionId },
  }));

  return ctx.ui.custom<string | null>((_tui, theme, _keybindings, done) => {
    const selectList = new ExtendedSelectList<{ subsessionId: string }>(theme, {
      title: `Reopen ${label} session`,
      items,
      maxVisibleRows: 12,
    });

    selectList.onCancel = () => done(null);
    selectList.onSelect = (item) => done(item.data?.subsessionId ?? null);
    selectList.onDelete = (item) => {
      const subsessionId = item.data?.subsessionId;
      if (!subsessionId) return;
      terminateSubsession(ctx.cwd, subsessionId)
        .then(() => ctx.ui.notify(`Deleted ${label} session`, "info"))
        .catch(() => ctx.ui.notify(`Failed to delete ${label} session`, "error"));
    };

    return selectList;
  });
}

export async function resolveSubsession(
  ctx: ExtensionCommandContext,
  input: CommandInput,
  config: { label: "plan" | "review"; agent: string },
): Promise<Subsession | null> {
  let prompt = "";
  const request: SubsessionRequest = {
    ctx,
    ...config,
    onSnapshot: (snapshot) => renderSnapshotWidget(ctx, config.agent, snapshot),
  };

  if (input.kind === "prompt") {
    prompt = input.prompt;
  } else if (input.kind === "resume") {
    request.id = input.subsessionId;
  } else {
    const selectedSubsessionId = await pickSubsessionId(ctx, config.label);
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
