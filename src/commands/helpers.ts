import { unlink, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../agent/types.js";
import type { Subsession } from "../subsession/types.js";
import { terminateSubsession } from "../subsession/storage.js";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import { MODE_ENTRY } from "./index.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subsession/types.js";
import { ExtendedSelectList, type SelectEntry } from "../ui/components/extended-select-list.js";
import { getPiPath, isMissingFileError, readJson } from "../utils.js";

type LoopAction =
  | { kind: "forward"; mode: AgentMode }
  | { kind: "feedback"; feedback: string }
  | { kind: "exit" }
  | { kind: "discard" };

interface LoopConfig {
  label: string;
  title: string;
  prefix: string;
  placeholder: string;
}

export async function saveSubsessionOutput(
  ctx: ExtensionCommandContext,
  subsession: Subsession,
): Promise<string | null> {
  const outputPath = getPiPath(
    subsession.label === "plan" ? "plans" : "reviews",
    ctx.cwd,
    `${
      subsession.title
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "_")
        .replaceAll(/^_+|_+$/g, "") || "untitled"
    }.md`,
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
  if (result.value === "assistant") {
    return { kind: "forward", mode: "assistant" };
  }
  if (result.value === "yolo") {
    return { kind: "forward", mode: "yolo" };
  }
  if (result.value === "exit") {
    return { kind: "exit" };
  }
  return null;
}

function discardSubsession(ctx: ExtensionCommandContext, subsession: Subsession) {
  const subsessionId = subsession.result.id;
  if (!subsessionId) {
    return;
  }
  terminateSubsession(ctx.cwd, subsessionId).catch(() => undefined);
}

async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mode: AgentMode,
  subsession: Subsession,
  outputPath: string | null,
): Promise<boolean> {
  const normalizedOutput = subsession.result.output.trim();
  if (!normalizedOutput) {
    ctx.ui.notify(`No ${subsession.label} to forward`, "warning");
    return false;
  }

  pi.appendEntry<{ mode: AgentMode }>(MODE_ENTRY, { mode });
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

export async function runSubsessionLoop(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
  config: LoopConfig,
) {
  try {
    const outputPath = await saveSubsessionOutput(ctx, subsession);

    while (true) {
      ctx.ui.setWidget(config.label, undefined);
      const action = await showActionUi(ctx, subsession.result.output, config);

      if (!action || action.kind === "exit") return;
      if (action.kind === "discard") {
        discardSubsession(ctx, subsession);
        return;
      }
      if (action.kind === "forward") {
        const forwarded = await forwardAction(pi, ctx, action.mode, subsession, outputPath);
        if (forwarded) return;
        continue;
      }

      await subsession.exec(action.feedback);
    }
  } finally {
    await subsession.dispose();
    ctx.ui.setWidget(config.label, undefined);
  }
}

export async function showActionUi(
  ctx: ExtensionCommandContext,
  output: string,
  config: LoopConfig,
): Promise<LoopAction | null> {
  const markdown = output.trim().length > 0 ? output : `_No ${config.label} output yet._`;

  const options: ActionSelectOption[] = [
    { value: "assistant", label: `${config.prefix} with assistant mode` },
    { value: "yolo", label: `${config.prefix} with YOLO mode` },
    { value: "exit", label: "Exit and save" },
  ];

  return ctx.ui.custom<LoopAction | null>((tui, theme, keybindings, done) => {
    const actionSelectList = new ActionSelectList(tui, keybindings, theme, {
      title: config.title,
      options,
      placeholder: config.placeholder,
    });
    actionSelectList.onSubmit = (result) => done(mapActionResult(result));
    actionSelectList.onCancel = () => done({ kind: "discard" });

    const scrollableView = new ScrollableView(tui, theme, { markdown, input: actionSelectList });
    scrollableView.focused = true;
    scrollableView.onCancel = () => done({ kind: "discard" });

    return scrollableView;
  });
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
