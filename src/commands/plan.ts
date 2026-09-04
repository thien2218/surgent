import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { openSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { runSubsessionLoop, pickSubsessionId } from "./helpers.js";
import { isUuidv7 } from "../utils.js";

const PLANNING = "planning";
const PLAN_PROMPT = readFileSync(new URL("./prompts/plan.md", import.meta.url), "utf8").trim();

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
    ctx.ui.setWidget(PLANNING, undefined);
    return;
  }

  if (subsession.result.status === "error") {
    await subsession.dispose();
    ctx.ui.setWidget(PLANNING, undefined);
    ctx.ui.notify(subsession.result.output, "error");
    return;
  }

  await runSubsessionLoop(pi, ctx, subsession, {
    label: PLANNING,
    title: "Forward this plan to main agent?",
    prefix: "Yes, proceed",
    placeholder: "Tell agent what to revise...",
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
  let prompt = "";
  const request: SubsessionRequest = {
    ctx,
    label: "plan",
    onSnapshot: (snapshot) =>
      renderSnapshotWidget(ctx, PLANNING, snapshot, ctx.model?.contextWindow),
  };

  if (input.kind === "prompt") {
    prompt = `${PLAN_PROMPT}\n\n## Task\n${input.prompt}`;
  } else if (input.kind === "resume") {
    request.id = input.subsessionId;
  } else {
    const selectedSubsessionId = await pickSubsessionId(ctx, "plan");
    if (!selectedSubsessionId) {
      return null;
    }
    request.id = selectedSubsessionId;
  }

  const session = await openSubsession(request);
  if (!request.id && session.result.status !== "error") {
    await session.exec(prompt);
  }
  if (!session.result.id) {
    await session.dispose();
    ctx.ui.notify(session.result.output || "Failed to initiate planning session", "error");
    return null;
  }

  return session;
}
