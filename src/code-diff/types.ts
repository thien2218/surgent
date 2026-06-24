import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SourceSelectorInput = {
  pr?: number;
  hash?: string;
  uncommitted?: boolean;
};

export type SourceSelector =
  | { kind: "pr"; value: number }
  | { kind: "hash"; value: string }
  | { kind: "uncommitted" };

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

export type CodeDiffToolParams = {
  source: SourceSelectorInput;
  base?: string;
  files?: string[];
};
