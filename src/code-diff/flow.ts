import {
  executeCommandOrThrow,
  getGithubRepoWithOwner,
  getPrNumstatLines,
  getPrPatch,
  resolveHashCommit,
  resolveLocalCommit,
  resolvePreferredRemoteName,
} from "./command.js";
import {
  filterPatchByFiles,
  isHashCandidate,
  normalizeSelectedFiles,
  parseNumstatLine,
} from "./parser.js";
import { buildPatchResult, buildSummaryResult, requireSelectedFiles } from "./result.js";
import type { CodeDiffSummaryFile, CodeDiffToolParams, CommandContext } from "./types.js";

export async function executePrFlow(
  request: CodeDiffToolParams,
  prNumber: number,
  sourceLabel: string,
  commandContext: CommandContext,
) {
  if (request.base !== undefined) {
    throw new Error("base is not allowed when source.pr is used.");
  }

  const repoWithOwner = await getGithubRepoWithOwner(commandContext);

  if (request.files === undefined) {
    const numstatLines = await getPrNumstatLines(commandContext, repoWithOwner, prNumber);
    const changedFiles = numstatLines
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({
      noChangesText: `No changes found in PR #${prNumber}.`,
      headerText: `Changed files in PR #${prNumber}:`,
      changedFiles,
      detailsBase: { sourceLabel },
    });
  }

  const selectedFiles = requireSelectedFiles(normalizeSelectedFiles(request.files));
  const prPatch = await getPrPatch(commandContext, prNumber);
  const patchText = filterPatchByFiles(prPatch, selectedFiles);

  return buildPatchResult({
    patchText,
    selectedFiles,
    detailsBase: { sourceLabel },
  });
}

export async function executeHashFlow(
  request: CodeDiffToolParams,
  sourceHashInput: string,
  sourceLabel: string,
  commandContext: CommandContext,
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

  const remoteName = await resolvePreferredRemoteName(commandContext);
  const baseCommitHash = await resolveHashCommit(commandContext, baseInput, "base", remoteName);
  const sourceCommitHash = await resolveHashCommit(
    commandContext,
    sourceHash,
    "source.hash",
    remoteName,
  );

  if (request.files === undefined) {
    const diffResult = await executeCommandOrThrow(
      commandContext,
      "git",
      ["diff", "--numstat", baseCommitHash, sourceCommitHash],
      `Failed to build summary diff for ${baseInput}..${sourceHash}.`,
    );

    const changedFiles = diffResult.stdout
      .split(/\r?\n/)
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({
      noChangesText: `No changes between ${baseInput} and ${sourceHash}.`,
      headerText: `Changed files between ${baseInput} and ${sourceHash}:`,
      changedFiles,
      detailsBase: {
        sourceLabel,
        baseRef: baseInput,
        baseCommitHash,
        sourceCommitHash,
      },
    });
  }

  const selectedFiles = requireSelectedFiles(normalizeSelectedFiles(request.files));
  const diffResult = await executeCommandOrThrow(
    commandContext,
    "git",
    ["diff", "--no-color", baseCommitHash, sourceCommitHash, "--", ...selectedFiles],
    `Failed to build patch diff for ${baseInput}..${sourceHash}.`,
  );

  return buildPatchResult({
    patchText: diffResult.stdout,
    selectedFiles,
    detailsBase: {
      sourceLabel,
      baseRef: baseInput,
      baseCommitHash,
      sourceCommitHash,
    },
  });
}

async function resolveUncommittedBase(
  request: CodeDiffToolParams,
  commandContext: CommandContext,
): Promise<{ baseRef: string; baseCommitHash: string }> {
  const explicitBaseInput = request.base?.trim();

  if (!explicitBaseInput) {
    const headCommitHash = await resolveLocalCommit(commandContext, "HEAD");
    if (!headCommitHash) {
      throw new Error("Unable to resolve HEAD commit in current repository.");
    }

    return {
      baseRef: "HEAD",
      baseCommitHash: headCommitHash,
    };
  }

  if (!isHashCandidate(explicitBaseInput)) {
    throw new Error(`base must be a git commit hash (7-40 hex). Received: ${explicitBaseInput}`);
  }

  const remoteName = await resolvePreferredRemoteName(commandContext);
  const baseCommitHash = await resolveHashCommit(commandContext, explicitBaseInput, "base", remoteName);

  return {
    baseRef: explicitBaseInput,
    baseCommitHash,
  };
}

export async function executeUncommittedFlow(
  request: CodeDiffToolParams,
  sourceLabel: string,
  commandContext: CommandContext,
) {
  const { baseRef, baseCommitHash } = await resolveUncommittedBase(request, commandContext);

  if (request.files === undefined) {
    const diffResult = await executeCommandOrThrow(
      commandContext,
      "git",
      ["diff", "--numstat", baseCommitHash],
      `Failed to build uncommitted summary diff for ${baseRef}.`,
    );

    const changedFiles = diffResult.stdout
      .split(/\r?\n/)
      .map((lineText) => parseNumstatLine(lineText))
      .filter((entry): entry is CodeDiffSummaryFile => entry !== null);

    return buildSummaryResult({
      noChangesText: `No uncommitted changes since ${baseRef}.`,
      headerText: `Uncommitted changes since ${baseRef}:`,
      changedFiles,
      detailsBase: {
        sourceLabel,
        baseRef,
        baseCommitHash,
      },
    });
  }

  const selectedFiles = requireSelectedFiles(normalizeSelectedFiles(request.files));
  const diffResult = await executeCommandOrThrow(
    commandContext,
    "git",
    ["diff", "--no-color", baseCommitHash, "--", ...selectedFiles],
    `Failed to build uncommitted patch diff for ${baseRef}.`,
  );

  return buildPatchResult({
    patchText: diffResult.stdout,
    selectedFiles,
    detailsBase: {
      sourceLabel,
      baseRef,
      baseCommitHash,
    },
  });
}
