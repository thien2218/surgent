import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { openSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { runSubsessionLoop, pickSubsessionId } from "./helpers.js";

const REVIEWING = "reviewing";
const REVIEW_PROMPT = readFileSync(new URL("./prompts/review.md", import.meta.url), "utf8").trim();

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
    ctx.ui.setWidget(REVIEWING, undefined);
    return;
  }

  if (reviewSubsession.result.status === "error") {
    await reviewSubsession.dispose();
    ctx.ui.setWidget(REVIEWING, undefined);
    ctx.ui.notify(reviewSubsession.result.output, "error");
    return;
  }

  await runSubsessionLoop(pi, ctx, reviewSubsession, {
    label: REVIEWING,
    title: "Next step?",
    prefix: "Fix issues",
    placeholder: "Tell agent what to check again...",
  });
}

async function resolveReviewSubsession(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<Subsession | null> {
  let prompt = "";
  const normalizedArgs = args.trim();
  const request: SubsessionRequest = {
    ctx,
    label: "review",
    onSnapshot: (snapshot) =>
      renderSnapshotWidget(ctx, REVIEWING, snapshot, ctx.model?.contextWindow),
  };

  if (normalizedArgs.length > 0) {
    prompt = `${REVIEW_PROMPT}\n\n## Review target\n${normalizedArgs}`;
  } else {
    const selectedSubsessionId = await pickSubsessionId(ctx, "review");
    if (!selectedSubsessionId) return null;
    request.id = selectedSubsessionId;
  }

  const session = await openSubsession(request);
  if (!request.id && session.result.status !== "error") {
    await session.exec(prompt);
  }

  if (!session.result.id) {
    await session.dispose();
    ctx.ui.notify(session.result.output || "Failed to initiate review session", "error");
    return null;
  }

  return session;
}
