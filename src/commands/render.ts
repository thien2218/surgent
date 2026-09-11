import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import type { LoopAction } from "./types.js";
import { Container, Loader } from "@earendil-works/pi-tui";
import { TruncatedText } from "@earendil-works/pi-tui";
import { Spacer } from "@earendil-works/pi-tui";
import { formatSnapshotText } from "../subagent/helpers.js";
import type { SubsessionSnapshot } from "../subagent/types.js";

const ACTIVITY_LABELS = [
  "analyzing",
  "researching",
  "synthesizing",
  "scrutinizing",
  "processing",
  "cooking",
] as const;

function mapActionResult(result: ActionSelectResult): LoopAction {
  if (result.type === "input") {
    return { kind: "feedback", feedback: result.value };
  }
  if (result.value === "open") {
    return { kind: "open" };
  }
  if (result.value === "save") {
    return { kind: "save" };
  }
  return { kind: "forward" };
}

export async function showPlanUi(
  ctx: ExtensionCommandContext,
  output: string,
  outputPath: string | null,
): Promise<LoopAction> {
  const markdown = output.trim().length > 0 ? output : "_No planner output yet._";
  const options: ActionSelectOption[] = [{ value: "forward", label: "Implement this plan" }];
  if (outputPath) {
    options.push({ value: "open", label: "Open plan in external editor" });
  }
  options.push({ value: "save", label: "Save and exit" });

  return ctx.ui.custom<LoopAction>((tui, theme, keybindings, done) => {
    const actionSelectList = new ActionSelectList(tui, keybindings, theme, {
      title: "What should surgent do next?",
      options,
      placeholder: "Feedback for planner agent",
    });
    actionSelectList.onSubmit = (result) => done(mapActionResult(result));
    actionSelectList.onCancel = () => done({ kind: "discard" });

    const scrollableView = new ScrollableView(tui, theme, { markdown, input: actionSelectList });
    scrollableView.focused = true;
    scrollableView.onCancel = () => done({ kind: "discard" });

    return scrollableView;
  });
}

export function renderSnapshotWidget(
  ctx: ExtensionCommandContext,
  label: string,
  snapshot: SubsessionSnapshot,
) {
  const activity = ACTIVITY_LABELS[Math.floor(Math.random() * ACTIVITY_LABELS.length)]!;
  const snapshotText = formatSnapshotText(snapshot);

  ctx.ui.setWidget(label, (tui, theme) => {
    const widget = new Container() as Container & { dispose?: () => void };
    const loader = new Loader(
      tui,
      (content) => theme.fg("accent", content),
      (content) => theme.fg("muted", content),
      `${label} (${activity}): ${snapshotText[0]}`,
    );
    if (snapshot.status !== "running") {
      loader.setIndicator({ frames: ["•"] });
    }

    widget.addChild(loader);
    for (const line of snapshotText.slice(1)) {
      widget.addChild(new TruncatedText(`  ${line}`, 1, 0));
    }

    widget.addChild(new Spacer(1));
    widget.dispose = () => loader.stop();
    return widget;
  });
}
