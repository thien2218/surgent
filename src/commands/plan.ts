import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { runSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { runSubsessionLoop } from "./helpers.js";
import { listPlanSessions, type PlanSessionPreview } from "./storage.js";
import { isUuidv7 } from "../utils.js";

const PLAN_AGENT = "planner";

type PlanCommandInput =
  | { kind: "list" }
  | { kind: "resume"; subsessionId: string }
  | { kind: "prompt"; prompt: string };

export async function planCommandHandler(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/plan requires interactive UI", "error");
    return;
  }

  const subsession = await resolveSession(ctx, parseCommandInput(args));
  if (!subsession) {
    ctx.ui.setWidget(PLAN_AGENT, undefined);
    return;
  }

  if (subsession.result.status === "error") {
    ctx.ui.setWidget(PLAN_AGENT, undefined);
    ctx.ui.notify(subsession.result.output, "error");
    return;
  }

  await runSubsessionLoop(pi, ctx, subsession, {
    agent: PLAN_AGENT,
    actionUi: {
      title: "Forward this plan to main agent?",
      prefix: "Yes, proceed",
      placeholder: "Tell planner what to revise...",
    },
    messages: {
      emptyOutput: "No planner output to forward",
      sendFailure: "Failed to forward plan",
    },
  });
}

export function parseCommandInput(args: string): PlanCommandInput {
  const normalized = args.trim();
  if (!normalized) {
    return { kind: "list" };
  }
  if (isUuidv7(normalized)) {
    return { kind: "resume", subsessionId: normalized };
  }
  return { kind: "prompt", prompt: normalized };
}

async function resolveSession(
  ctx: ExtensionCommandContext,
  parsedInput: PlanCommandInput,
): Promise<Subsession | null> {
  const pid = ctx.sessionManager.getSessionId();
  const request: SubsessionRequest = { pid, label: "plan", agent: PLAN_AGENT, input: "" };

  if (parsedInput.kind === "prompt") {
    request.input = parsedInput.prompt;
    if (ctx.model) {
      const { id, provider } = ctx.model;
      const modelId = id.includes("/") ? id : `${provider}/${id}`;
      request.modelId = modelId;
    }
  } else if (parsedInput.kind === "resume") {
    request.id = parsedInput.subsessionId;
  } else {
    const selectedSubsessionId = await pickPlanSessionId(ctx, pid);
    if (!selectedSubsessionId) {
      return null;
    }
    request.id = selectedSubsessionId;
  }

  const session = await runSubsession(request, (snapshot) =>
    renderSnapshotWidget(ctx, PLAN_AGENT, snapshot, ctx.model?.contextWindow),
  );
  if (!session.result.id) {
    ctx.ui.notify(session.result.output || "Failed to initiate planning session", "error");
    return null;
  }

  return session;
}

async function pickPlanSessionId(
  ctx: ExtensionCommandContext,
  pid: string,
): Promise<string | null> {
  const planSessions = await listPlanSessions(ctx.cwd, pid);
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
