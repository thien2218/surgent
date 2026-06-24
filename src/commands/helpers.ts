import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "../permission/types.js";
import { resolveInteractionHandoff } from "../subsession/index.js";
import type { Subsession } from "../subsession/types.js";
import { terminateSubsession } from "../subsession/storage.js";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import { MODE_ENTRY } from "./index.js";

type LoopAction = { kind: "forward"; mode: AgentMode } | { kind: "feedback"; feedback: string };

interface ActionUiConfig {
  title: string;
  prefix: string;
  placeholder: string;
}

interface ForwardMessages {
  emptyOutput: string;
  sendFailure: string;
}

interface LoopConfig {
  agent: string;
  actionUi: ActionUiConfig;
  messages: ForwardMessages;
}

export async function runSubsessionLoop(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  subsession: Subsession,
  config: LoopConfig,
) {
  const { messages, agent, actionUi } = config;
  try {
    while (true) {
      let resumeInput = await resolveInteractionHandoff(ctx, subsession.result.interaction);

      if (!resumeInput) {
        ctx.ui.setWidget(agent, undefined);
        const action = await showActionUi(ctx, subsession.result.output, actionUi, agent);
        if (!action) return;

        if (action.kind === "forward") {
          const forwarded = await forwardAction(pi, ctx, action.mode, subsession, messages);
          if (forwarded) return;
          continue;
        }

        resumeInput = action.feedback;
      }

      await subsession.exec(resumeInput);
    }
  } finally {
    ctx.ui.setWidget(agent, undefined);
  }
}

export async function showActionUi(
  ctx: ExtensionCommandContext,
  output: string,
  config: ActionUiConfig,
  agent: string,
): Promise<LoopAction | null> {
  const markdown = output.trim().length > 0 ? output : `_No ${agent} output yet._`;

  const options: ActionSelectOption[] = [
    { value: "assistant", label: `${config.prefix} with assistant mode` },
    { value: "yolo", label: `${config.prefix} with YOLO mode` },
  ];

  return ctx.ui.custom<LoopAction | null>((tui, theme, keybindings, done) => {
    const actionSelectList = new ActionSelectList(tui, keybindings, theme, {
      title: config.title,
      options,
      placeholder: config.placeholder,
    });

    actionSelectList.onSubmit = (result) => done(mapActionResult(result));
    actionSelectList.onCancel = () => done(null);

    const scrollableView = new ScrollableView(tui, theme, {
      markdown,
      inputComponent: actionSelectList,
    });

    scrollableView.focused = true;
    scrollableView.onCancel = () => done(null);

    return scrollableView;
  });
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
  return null;
}

async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mode: AgentMode,
  subsession: Subsession,
  copy: ForwardMessages,
): Promise<boolean> {
  const normalizedOutput = subsession.result.output.trim();
  if (!normalizedOutput) {
    ctx.ui.notify(copy.emptyOutput, "warning");
    return false;
  }

  pi.appendEntry<{ mode: AgentMode }>(MODE_ENTRY, { mode });

  try {
    pi.sendUserMessage(normalizedOutput);
  } catch {
    ctx.ui.notify(copy.sendFailure, "error");
    return false;
  }

  terminateSubsession(ctx.cwd, subsession.result.id!).catch(() => undefined);
  return true;
}
