import {
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
  CodeDiffRequest,
  CodeDiffPatchDetails,
  CodeDiffSummaryDetails,
  CodeDiffSummaryFile,
  CodeDiffToolParams,
  CommandRunner,
} from "./types.js";

type GitDiffFlowOptions = {
  request: CodeDiffRequest;
  runCommand: CommandRunner;
  rangeArgs: string[];
  detailsBase: Omit<CodeDiffSummaryDetails, "mode" | "files"> &
    Omit<CodeDiffPatchDetails, "mode" | "selectedFiles" | "hasChanges">;
};

async function executeGitDiffFlow(options: GitDiffFlowOptions) {
  if (options.request.files === undefined) {
    const diffResult = await options.runCommand(
      "git",
      ["diff", "--numstat", ...options.rangeArgs],
      "Failed to build summary diff",
    );

    const changedFiles = diffResult.stdout
      .split(/\r?\n/)
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({ changedFiles, detailsBase: options.detailsBase });
  }

  const selectedFiles = requireSelectedFiles(options.request.files);
  const { stdout } = await options.runCommand(
    "git",
    ["diff", "--no-color", ...options.rangeArgs, "--", ...selectedFiles],
    "Failed to build patch diff",
  );

  return buildPatchResult({ patchText: stdout, selectedFiles, detailsBase: options.detailsBase });
}

async function executePrFlow(request: CodeDiffRequest, pr: number, runCommand: CommandRunner) {
  const repoWithOwner = await getGithubRepoWithOwner(runCommand);

  if (request.files === undefined) {
    const numstatLines = await getPrNumstatLines(runCommand, repoWithOwner, pr);
    const changedFiles = numstatLines
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({ changedFiles, detailsBase: { sourceLabel: `pr:${pr}` } });
  }

  const selectedFiles = requireSelectedFiles(request.files);
  const prPatch = await getPrPatch(runCommand, pr);
  const patchText = filterPatchByFiles(prPatch, selectedFiles);

  return buildPatchResult({ patchText, selectedFiles, detailsBase: { sourceLabel: `pr:${pr}` } });
}

async function executeHashFlow(
  request: CodeDiffRequest,
  hashInput: string,
  runCommand: CommandRunner,
) {
  const baseRef = request.base?.trim();
  if (!baseRef) {
    throw new Error("base is required when mode=hash.");
  }

  const hash = hashInput.trim();
  if (!isHashCandidate(baseRef)) {
    throw new Error(`base must be a git commit hash (7-40 hex). Received: ${baseRef}`);
  }
  if (!isHashCandidate(hash)) {
    throw new Error(`hash must be a git commit hash (7-40 hex). Received: ${hash}`);
  }

  const remoteName = await resolvePreferredRemoteName(runCommand);
  const baseCommitHash = await resolveHashCommit(runCommand, baseRef, "base", remoteName);
  const sourceCommitHash = await resolveHashCommit(runCommand, hash, "hash", remoteName);

  return executeGitDiffFlow({
    request,
    runCommand,
    rangeArgs: [baseCommitHash, sourceCommitHash],
    detailsBase: { sourceLabel: `hash:${hash}`, baseRef, baseCommitHash, sourceCommitHash },
  });
}

async function executeUncommittedFlow(request: CodeDiffRequest, runCommand: CommandRunner) {
  const baseInput = request.base?.trim();
  let baseRef = "HEAD";
  let baseCommitHash: string;

  if (!baseInput) {
    const headCommitHash = await resolveLocalCommit(runCommand, "HEAD");
    if (!headCommitHash) {
      throw new Error("Unable to resolve HEAD commit in current repository.");
    }
    baseCommitHash = headCommitHash;
  } else {
    if (!isHashCandidate(baseInput)) {
      throw new Error(`base must be a git commit hash (7-40 hex). Received: ${baseInput}`);
    }

    const remoteName = await resolvePreferredRemoteName(runCommand);
    baseCommitHash = await resolveHashCommit(runCommand, baseInput, "base", remoteName);
    baseRef = baseInput;
  }

  return executeGitDiffFlow({
    request,
    runCommand,
    rangeArgs: [baseCommitHash],
    detailsBase: { sourceLabel: "uncommitted", baseRef, baseCommitHash },
  });
}

export async function executeFlow(request: CodeDiffToolParams, runCommand: CommandRunner) {
  if (request.mode === "pr") {
    return executePrFlow({ files: request.files }, request.pr, runCommand);
  }
  if (request.mode === "hash") {
    return executeHashFlow({ base: request.base, files: request.files }, request.hash, runCommand);
  }
  return executeUncommittedFlow({ base: request.base, files: request.files }, runCommand);
}
