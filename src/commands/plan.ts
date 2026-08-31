import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { runSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { applyCurrentModel, runSubsessionLoop, pickSubsessionId } from "./helpers.js";
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

  const subsession = await resolveSubsession(ctx, parseCommandInput(args));
  if (!subsession) {
    ctx.ui.setWidget(PLAN_AGENT, undefined);
    return;
  }

  if (subsession.result.status === "error") {
    await subsession.dispose();
    ctx.ui.setWidget(PLAN_AGENT, undefined);
    ctx.ui.notify(subsession.result.output, "error");
    return;
  }

  await runSubsessionLoop(pi, ctx, subsession, {
    agent: PLAN_AGENT,
    title: "Forward this plan to main agent?",
    prefix: "Yes, proceed",
    placeholder: "Tell planner what to revise...",
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

async function resolveSubsession(
  ctx: ExtensionCommandContext,
  input: PlanCommandInput,
): Promise<Subsession | null> {
  const pid = ctx.sessionManager.getSessionId();
  const request: SubsessionRequest = { ctx, pid, label: "plan", agent: PLAN_AGENT, input: "" };

  if (input.kind === "prompt") {
    request.input = input.prompt;
    applyCurrentModel(ctx, request);
  } else if (input.kind === "resume") {
    request.id = input.subsessionId;
  } else {
    const selectedSubsessionId = await pickSubsessionId(ctx, pid, "plan");
    if (!selectedSubsessionId) {
      return null;
    }
    request.id = selectedSubsessionId;
  }

  const session = await runSubsession(request, (snapshot) =>
    renderSnapshotWidget(ctx, PLAN_AGENT, snapshot, ctx.model?.contextWindow),
  );
  if (!session.result.id) {
    await session.dispose();
    ctx.ui.notify(session.result.output || "Failed to initiate planning session", "error");
    return null;
  }

  return session;
}
