import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { resolveInteractionHandoff } from "../subsession/index.js";
import type { Subsession, SubsessionRequest } from "../subsession/types.js";
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
import { getPiPath, readJson } from "../utils.js";

type LoopAction =
  | { kind: "forward"; mode: AgentMode }
  | { kind: "feedback"; feedback: string }
  | { kind: "exit" }
  | { kind: "discard" };

interface LoopConfig {
  agent: string;
  title: string;
  prefix: string;
  placeholder: string;
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
    while (true) {
      let resumeInput = await resolveInteractionHandoff(ctx, subsession.result.interaction);

      if (!resumeInput) {
        ctx.ui.setWidget(config.agent, undefined);
        const action = await showActionUi(ctx, subsession.result.output, config);

        if (!action || action.kind === "exit") return;
        if (action.kind === "discard") {
          discardSubsession(ctx, subsession);
          return;
        }
        if (action.kind === "forward") {
          const forwarded = await forwardAction(pi, ctx, action.mode, subsession);
          if (forwarded) return;
          continue;
        }

        resumeInput = action.feedback;
      }

      await subsession.exec(resumeInput);
    }
  } finally {
    ctx.ui.setWidget(config.agent, undefined);
  }
}

export async function showActionUi(
  ctx: ExtensionCommandContext,
  output: string,
  config: LoopConfig,
): Promise<LoopAction | null> {
  const markdown = output.trim().length > 0 ? output : `_No ${config.agent} output yet._`;

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

    const scrollableView = new ScrollableView(tui, theme, {
      markdown,
      inputComponent: actionSelectList,
    });

    scrollableView.focused = true;
    scrollableView.onCancel = () => done({ kind: "discard" });

    return scrollableView;
  });
}

export function applyCurrentModel(ctx: ExtensionCommandContext, request: SubsessionRequest) {
  if (!ctx.model) return;
  const { id, provider } = ctx.model;
  request.modelId = id.includes("/") ? id : `${provider}/${id}`;
}

export async function pickSubsessionId(
  ctx: ExtensionContext,
  pid: string,
  label: "plan" | "review",
): Promise<string | null> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", ctx.cwd), {});
  const previews: { subsessionId: string; title: string }[] = [];

  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (metadata.label === label && metadata.pid === pid) {
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
