import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { InteractiveSubsession } from "../subsession/types.js";
import { MODE_ENTRY } from "./index.js";
import { runInteractive } from "../subsession/index.js";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import { listPlanSessions, type PlanSessionPreview } from "./storage.js";
import type { PlanAction, PlanCommandInput } from "./types.js";
import type { AgentMode } from "../permission/types.js";

const PLAN_AGENT = "planner";
const PLAN_LABEL = "plan";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORWARD_OPTIONS: ActionSelectOption[] = [
  { value: "assistant", label: "Yes, proceed with assistant mode" },
  { value: "yolo", label: "Yes, proceed with YOLO mode" },
  { value: "exit", label: "Exit planning" },
];

export async function planCommandHandler(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/plan requires interactive UI", "error");
    return;
  }
  const parsedInput = parseCommandInput(args);
  const session = await resolveSession(ctx, parsedInput);
  if (!session) {
    return;
  }

  const initialStatus = session.result.status;
  if (initialStatus === "error") {
    ctx.ui.notify(session.result.output, "error");
    return;
  }

  while (true) {
    const action = await showUi(ctx, session.result.output);
    if (!action || action.kind === "exit") {
      return;
    }

    if (action.kind === "forward") {
      const didForward = await forwardAction(pi, ctx, action.mode, session.result.output);
      if (didForward) {
        return;
      }
      continue;
    }

    await session.exec(action.feedback);

    if (session.result.status === "error") {
      ctx.ui.notify("Planner turn failed. Please revise and retry.", "error");
    }
  }
}

export function parseCommandInput(rawArgs: string): PlanCommandInput {
  const normalizedArgs = rawArgs.trim();
  if (!normalizedArgs) {
    return { kind: "list" };
  }
  if (UUID_PATTERN.test(normalizedArgs)) {
    return { kind: "resume", subsessionId: normalizedArgs };
  }
  return { kind: "prompt", prompt: normalizedArgs };
}

async function resolveSession(
  ctx: ExtensionCommandContext,
  parsedInput: PlanCommandInput,
): Promise<InteractiveSubsession | null> {
  const parentSessionId = ctx.sessionManager.getSessionId();

  if (parsedInput.kind === "prompt") {
    const session = await runInteractive({
      parentId: parentSessionId,
      label: PLAN_LABEL,
      agent: PLAN_AGENT,
      input: parsedInput.prompt,
    });

    if (!session.id) {
      ctx.ui.notify(session.result.output || "Failed to create planning session", "error");
      return null;
    }

    return session;
  }

  const selectedSubsessionId =
    parsedInput.kind === "resume"
      ? parsedInput.subsessionId
      : await pickStoredPlanSessionId(ctx, parentSessionId);

  if (!selectedSubsessionId) {
    return null;
  }

  const session = await runInteractive({
    parentId: parentSessionId,
    id: selectedSubsessionId,
    label: PLAN_LABEL,
    agent: PLAN_AGENT,
    input: "",
  });

  if (!session.id) {
    ctx.ui.notify(
      session.result.output || `Plan subsession not found: ${selectedSubsessionId}`,
      "error",
    );
    return null;
  }

  return session;
}

async function pickStoredPlanSessionId(
  ctx: ExtensionCommandContext,
  parentSessionId: string,
): Promise<string | null> {
  const planSessions = await listPlanSessions(ctx.cwd, parentSessionId);
  if (planSessions.length === 0) {
    ctx.ui.notify("No stored planning sessions", "warning");
    return null;
  }

  const optionMap = new Map<string, string>();
  const options = planSessions.map((preview) => {
    const optionLabel = formatSessionOption(preview);
    optionMap.set(optionLabel, preview.subsessionId);
    return optionLabel;
  });

  const selectedOption = await ctx.ui.select("Reopen plan session", options);
  if (!selectedOption) {
    return null;
  }

  return optionMap.get(selectedOption) ?? null;
}

function formatSessionOption(preview: PlanSessionPreview): string {
  const shortId = preview.subsessionId.slice(0, 8);
  return `${preview.title} (${shortId})`;
}

async function showUi(
  ctx: ExtensionCommandContext,
  plannerOutput: string,
): Promise<PlanAction | null> {
  const markdown = plannerOutput.trim().length > 0 ? plannerOutput : "_No planner output yet._";

  return ctx.ui.custom<PlanAction | null>((tui, theme, keybindings, done) => {
    const actionSelectList = new ActionSelectList(tui, keybindings, theme, {
      title: "Forward this plan to main agent?",
      options: FORWARD_OPTIONS,
      placeholder: "Tell planner what to revise...",
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

function mapActionResult(result: ActionSelectResult): PlanAction {
  if (result.type === "input") {
    return { kind: "revise", feedback: result.value };
  }
  if (result.value === "assistant") {
    return { kind: "forward", mode: "assistant" };
  }
  if (result.value === "yolo") {
    return { kind: "forward", mode: "yolo" };
  }
  return { kind: "exit" };
}

async function forwardAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mode: AgentMode,
  plannerOutput: string,
): Promise<boolean> {
  const normalizedOutput = plannerOutput.trim();
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

  const modeLabel = mode === "yolo" ? "YOLO" : "assistant";
  ctx.ui.notify(`Forwarded plan to main agent (${modeLabel} next turn).`, "info");
  return true;
}
