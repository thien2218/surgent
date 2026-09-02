import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { runSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { applyCurrentModel, runSubsessionLoop, pickSubsessionId } from "./helpers.js";

const REVIEW_AGENT = "default";
const REVIEW_PROMPT = readFileSync(new URL("./prompts/review.md", import.meta.url), "utf8").trim();

const REVIEW_LOOP_CONFIG = {
  agent: REVIEW_AGENT,
  title: "Next step?",
  prefix: "Fix issues",
  placeholder: "Tell agent what to check again...",
};

export async function reviewCommandHandler(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/review requires interactive UI", "error");
    return;
  }

  const reviewSubsession = await resolveReviewSubsession(args, ctx);
  if (!reviewSubsession) {
    ctx.ui.setWidget(REVIEW_AGENT, undefined);
    return;
  }

  if (reviewSubsession.result.status === "error") {
    await reviewSubsession.dispose();
    ctx.ui.setWidget(REVIEW_AGENT, undefined);
    ctx.ui.notify(reviewSubsession.result.output, "error");
    return;
  }

  await runSubsessionLoop(pi, ctx, reviewSubsession, REVIEW_LOOP_CONFIG);
}

async function resolveReviewSubsession(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<Subsession | null> {
  const normalizedArgs = args.trim();
  const request: SubsessionRequest = { ctx, label: "review", agent: REVIEW_AGENT, input: "" };

  if (normalizedArgs.length > 0) {
    request.input = `${REVIEW_PROMPT}\n\n## Review target\n${normalizedArgs}`;
    applyCurrentModel(ctx, request);
  } else {
    const selectedSubsessionId = await pickSubsessionId(ctx, "review");
    if (!selectedSubsessionId) return null;
    request.id = selectedSubsessionId;
  }

  const session = await runSubsession(request, (snapshot) =>
    renderSnapshotWidget(ctx, REVIEW_AGENT, snapshot, ctx.model?.contextWindow),
  );

  if (!session.result.id) {
    await session.dispose();
    ctx.ui.notify(session.result.output || "Failed to initiate review session", "error");
    return null;
  }

  return session;
}
