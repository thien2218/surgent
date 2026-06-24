import {
  executeCommandOrThrow,
  getGithubRepoWithOwner,
  getPrNumstatLines,
  getPrPatch,
  resolveHashCommit,
  resolveLocalCommit,
  resolvePreferredRemoteName,
} from "./command.js";
import { filterPatchByFiles, isHashCandidate, parseNumstatLine } from "./parser.js";
import { buildPatchResult, buildSummaryResult, requireSelectedFiles } from "./result.js";
import type {
  CodeDiffPatchDetails,
  CodeDiffSummaryDetails,
  CodeDiffSummaryFile,
  CodeDiffToolParams,
  CommandContext,
} from "./types.js";

type GitDiffFlowOptions = {
  request: CodeDiffToolParams;
  context: CommandContext;
  rangeArgs: string[];
  detailsBase: Omit<CodeDiffSummaryDetails, "mode" | "files"> &
    Omit<CodeDiffPatchDetails, "mode" | "selectedFiles" | "hasChanges">;
};

async function executeGitDiffFlow(options: GitDiffFlowOptions) {
  if (options.request.files === undefined) {
    const diffResult = await executeCommandOrThrow(
      options.context,
      "git",
      ["diff", "--numstat", ...options.rangeArgs],
      "Failed to build summary diff.",
    );

    const changedFiles = diffResult.stdout
      .split(/\r?\n/)
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({ changedFiles, detailsBase: options.detailsBase });
  }

  const selectedFiles = requireSelectedFiles(options.request.files);
  const diffResult = await executeCommandOrThrow(
    options.context,
    "git",
    ["diff", "--no-color", ...options.rangeArgs, "--", ...selectedFiles],
    "Failed to build patch diff.",
  );

  return buildPatchResult({
    patchText: diffResult.stdout,
    selectedFiles,
    detailsBase: options.detailsBase,
  });
}

export async function executePrFlow(
  request: CodeDiffToolParams,
  prNumber: number,
  sourceLabel: string,
  context: CommandContext,
) {
  if (request.base !== undefined) {
    throw new Error("base is not allowed when source.pr is used.");
  }
  const repoWithOwner = await getGithubRepoWithOwner(context);

  if (request.files === undefined) {
    const numstatLines = await getPrNumstatLines(context, repoWithOwner, prNumber);
    const changedFiles = numstatLines
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({ changedFiles, detailsBase: { sourceLabel } });
  }

  const selectedFiles = requireSelectedFiles(request.files);
  const prPatch = await getPrPatch(context, prNumber);
  const patchText = filterPatchByFiles(prPatch, selectedFiles);

  return buildPatchResult({ patchText, selectedFiles, detailsBase: { sourceLabel } });
}

export async function executeHashFlow(
  request: CodeDiffToolParams,
  sourceHashInput: string,
  sourceLabel: string,
  context: CommandContext,
) {
  const baseInput = request.base?.trim();
  if (!baseInput) {
    throw new Error("base is required when source.hash is used.");
  }

  const sourceHash = sourceHashInput.trim();
  if (!isHashCandidate(baseInput)) {
    throw new Error(`base must be a git commit hash (7-40 hex). Received: ${baseInput}`);
  }
  if (!isHashCandidate(sourceHash)) {
    throw new Error(`source.hash must be a git commit hash (7-40 hex). Received: ${sourceHash}`);
  }

  const remoteName = await resolvePreferredRemoteName(context);
  const baseCommitHash = await resolveHashCommit(context, baseInput, "base", remoteName);
  const sourceCommitHash = await resolveHashCommit(context, sourceHash, "source.hash", remoteName);

  return executeGitDiffFlow({
    request,
    context,
    rangeArgs: [baseCommitHash, sourceCommitHash],
    detailsBase: { sourceLabel, baseRef: baseInput, baseCommitHash, sourceCommitHash },
  });
}

export async function executeUncommittedFlow(
  request: CodeDiffToolParams,
  sourceLabel: string,
  context: CommandContext,
) {
  const baseInput = request.base?.trim();
  let baseRef = "HEAD";
  let baseCommitHash: string;

  if (!baseInput) {
    const headCommitHash = await resolveLocalCommit(context, "HEAD");
    if (!headCommitHash) {
      throw new Error("Unable to resolve HEAD commit in current repository.");
    }
    baseCommitHash = headCommitHash;
  } else {
    if (!isHashCandidate(baseInput)) {
      throw new Error(`base must be a git commit hash (7-40 hex). Received: ${baseInput}`);
    }

    const remoteName = await resolvePreferredRemoteName(context);
    baseCommitHash = await resolveHashCommit(context, baseInput, "base", remoteName);
    baseRef = baseInput;
  }

  return executeGitDiffFlow({
    request,
    context,
    rangeArgs: [baseCommitHash],
    detailsBase: { sourceLabel, baseRef, baseCommitHash },
  });
}
