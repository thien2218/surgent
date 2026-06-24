import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type GitCommandResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;

export type CommandContext = {
  pi: ExtensionAPI;
  cwd: string;
  signal?: AbortSignal;
};

export type CodeDiffSummaryFile = {
  path: string;
  addedLines: number | null;
  removedLines: number | null;
  isBinary: boolean;
};

export type CodeDiffSummaryDetails = {
  mode: "summary";
  sourceLabel: string;
  files: CodeDiffSummaryFile[];
  baseRef?: string;
  baseCommitHash?: string;
  sourceCommitHash?: string;
};

export type CodeDiffPatchDetails = {
  mode: "patch";
  sourceLabel: string;
  selectedFiles: string[];
  hasChanges: boolean;
  baseRef?: string;
  baseCommitHash?: string;
  sourceCommitHash?: string;
};

export type CodeDiffToolDetails = CodeDiffSummaryDetails | CodeDiffPatchDetails;

export type CodeDiffPrParams = {
  mode: "pr";
  pr: number;
  files?: string[];
};

export type CodeDiffHashParams = {
  mode: "hash";
  base: string;
  hash: string;
  files?: string[];
};

export type CodeDiffUncommittedParams = {
  mode: "uncommitted";
  base?: string;
  files?: string[];
};

export type CodeDiffToolParams = CodeDiffPrParams | CodeDiffHashParams | CodeDiffUncommittedParams;

export type CodeDiffFlowRequest = {
  base?: string;
  files?: string[];
};
