import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExecResult,
} from "@earendil-works/pi-coding-agent";
import type { SubsessionRequest, Subsession } from "../subsession/types.js";
import { runSubsession, renderSnapshotWidget } from "../subsession/index.js";
import { applyCurrentModel, runSubsessionLoop, pickSubsessionId } from "./helpers.js";

const REVIEW_AGENT = "reviewer";
const REVIEW_LOOP_CONFIG = {
  agent: REVIEW_AGENT,
  title: "Next step?",
  prefix: "Fix issues",
  placeholder: "Tell reviewer what to check again...",
};

interface PullRequestSummary {
  number: number;
  title: string;
}

export async function reviewCommandHandler(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/review requires interactive UI", "error");
    return;
  }

  const reviewSubsession = await resolveReviewSubsession(pi, args, ctx);
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
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<Subsession | null> {
  const normalizedArgs = args.trim();
  const pid = ctx.sessionManager.getSessionId();
  const request: SubsessionRequest = { ctx, pid, label: "review", agent: REVIEW_AGENT, input: "" };

  if (normalizedArgs.length > 0) {
    request.input = normalizedArgs;
    applyCurrentModel(ctx, request);
  } else {
    const startOption = await ctx.ui.select("Start review", [
      "List available PRs to review",
      "List existing reviews",
    ]);
    if (!startOption) return null;

    if (startOption.includes("PRs")) {
      const reviewPrompt = await resolvePromptFromPullRequest(pi, ctx);
      if (!reviewPrompt) return null;

      request.input = reviewPrompt;
      applyCurrentModel(ctx, request);
      return null;
    } else if (startOption.includes("reviews")) {
      const selectedSubsessionId = await pickSubsessionId(ctx, pid, "review");
      if (!selectedSubsessionId) return null;
      request.id = selectedSubsessionId;
    }
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

async function resolvePromptFromPullRequest(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<string | null> {
  const pullRequests = await loadOpenPullRequests(pi, ctx);

  if (!pullRequests) return null;
  if (pullRequests.length === 0) {
    ctx.ui.notify("No open pull requests found", "warning");
    return null;
  }

  const optionByNumber = new Map<string, number>();
  const options = pullRequests.map((pullRequest) => {
    const optionLabel = `#${pullRequest.number} ${pullRequest.title}`;
    optionByNumber.set(optionLabel, pullRequest.number);
    return optionLabel;
  });

  const selectedOption = await ctx.ui.select("Choose pull request to review", options);
  if (!selectedOption) {
    return null;
  }

  const selectedPullRequestNumber = optionByNumber.get(selectedOption);
  if (selectedPullRequestNumber === undefined) {
    ctx.ui.notify("Selected pull request was not found", "error");
    return null;
  }

  return `Review pull request #${selectedPullRequestNumber}. Focus on correctness, regressions, and actionable fixes.`;
}

async function loadOpenPullRequests(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<PullRequestSummary[] | null> {
  let result: ExecResult;

  try {
    result = await pi.exec("gh", ["pr", "list", "--state", "open", "--json", "number,title"], {
      cwd: ctx.cwd,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to run gh pr list: ${message}`, "error");
    return null;
  }

  if (result.code !== 0) {
    const errorOutput = result.stderr.trim() || result.stdout.trim() || "Unknown gh error";
    ctx.ui.notify(`Failed to list open pull requests: ${errorOutput}`, "error");
    return null;
  }

  return parsePullRequestList(result.stdout, ctx);
}

function parsePullRequestList(
  stdout: string,
  ctx: ExtensionCommandContext,
): PullRequestSummary[] | null {
  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(stdout);
  } catch {
    ctx.ui.notify("Failed to parse gh pr list output", "error");
    return null;
  }

  if (!Array.isArray(parsedOutput)) {
    ctx.ui.notify("Malformed gh pr list output", "error");
    return null;
  }

  const pullRequests: PullRequestSummary[] = [];
  for (const pullRequestItem of parsedOutput) {
    if (!isPullRequestSummary(pullRequestItem)) {
      ctx.ui.notify("Malformed gh pr list output", "error");
      return null;
    }
    pullRequests.push({
      number: pullRequestItem.number,
      title: pullRequestItem.title,
    });
  }

  return pullRequests;
}

function isPullRequestSummary(value: unknown): value is PullRequestSummary {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["number"] === "number" &&
    Number.isInteger(candidate["number"]) &&
    typeof candidate["title"] === "string"
  );
}
