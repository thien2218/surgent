import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { createResumeInput, runInteractive } from "../subsession/index.js";
import {
  ActionSelectList,
  type ActionSelectOption,
  type ActionSelectResult,
} from "../ui/components/action-select-list.js";
import { ScrollableView } from "../ui/components/scrollable-view.js";
import { forwardAction, renderSnapshotWidget } from "./helpers.js";
import { listPlanSessions, type PlanSessionPreview } from "./storage.js";
import type { PlanAction, PlanCommandInput } from "./types.js";
import { isUuid } from "../utils.js";
import { askQuestions } from "../questionnaire/helpers.js";
import type { Question } from "../questionnaire/types.js";

const PLAN_LABEL = "plan";
const FORWARD_OPTIONS: ActionSelectOption[] = [
  { value: "assistant", label: "Yes, proceed with assistant mode" },
  { value: "yolo", label: "Yes, proceed with YOLO mode" },
];

export async function planCommandHandler(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/plan requires interactive UI", "error");
    return;
  }

  try {
    let subsession: Subsession | null = null;

    while (true) {
      if (!subsession) {
        subsession = await resolveSession(ctx, parseCommandInput(args));
        if (!subsession) return;
      }
      if (subsession.result.status === "error") {
        ctx.ui.notify(subsession.result.output, "error");
        return;
      }

      const interaction = subsession.result.interaction;

      if (interaction && interaction.toolName === "questionnaire") {
        const result = await askQuestions(interaction.input["questions"] as Question[], ctx.ui);
        await subsession.exec(createResumeInput(interaction, result));
      } else {
        ctx.ui.setWidget(PLAN_LABEL, undefined);
        const action = await showUi(ctx, subsession.result.output);
        if (!action) return;

        if (action.kind === "forward") {
          if (await forwardAction(pi, ctx, action.mode, subsession)) return;
          continue;
        }
        subsession.exec(action.feedback);
      }
    }
  } finally {
    ctx.ui.setWidget(PLAN_LABEL, undefined);
  }
}

export function parseCommandInput(rawArgs: string): PlanCommandInput {
  const normalizedArgs = rawArgs.trim();
  if (!normalizedArgs) {
    return { kind: "list" };
  }
  if (isUuid(normalizedArgs)) {
    return { kind: "resume", subsessionId: normalizedArgs };
  }
  return { kind: "prompt", prompt: normalizedArgs };
}

async function resolveSession(
  ctx: ExtensionCommandContext,
  parsedInput: PlanCommandInput,
): Promise<Subsession | null> {
  const pid = ctx.sessionManager.getSessionId();
  const request: SubsessionRequest = { pid, label: PLAN_LABEL, agent: "planner", input: "" };

  if (parsedInput.kind === "prompt") {
    request.input = parsedInput.prompt;
    if (ctx.model) {
      const { id, provider } = ctx.model;
      const modelId = id.includes("/") ? id : `${provider}/${id}`;
      request.modelId = modelId;
    }
  } else {
    const selectedSubsessionId =
      parsedInput.kind === "resume"
        ? parsedInput.subsessionId
        : await pickStoredPlanSessionId(ctx, pid);

    if (!selectedSubsessionId) {
      ctx.ui.notify(`Plan subsession not found: ${selectedSubsessionId}`, "error");
      return null;
    }

    request.id = selectedSubsessionId;
  }

  const session = await runInteractive(request, (snapshot) =>
    renderSnapshotWidget(ctx, PLAN_LABEL, snapshot),
  );
  if (!session.result.id) {
    ctx.ui.notify(session.result.output || "Failed to initiate planning session", "error");
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

function mapActionResult(result: ActionSelectResult): PlanAction | null {
  if (result.type === "input") {
    return { kind: "revise", feedback: result.value };
  }
  if (result.value === "assistant") {
    return { kind: "forward", mode: "assistant" };
  }
  if (result.value === "yolo") {
    return { kind: "forward", mode: "yolo" };
  }
  return null;
}
