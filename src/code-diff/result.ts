import type { CodeDiffPatchDetails, CodeDiffSummaryDetails, CodeDiffSummaryFile } from "./types.js";

type SummaryResultOptions = {
  changedFiles: CodeDiffSummaryFile[];
  detailsBase: Omit<CodeDiffSummaryDetails, "mode" | "files">;
};

type PatchResultOptions = {
  patchText: string;
  selectedFiles: string[];
  detailsBase: Omit<CodeDiffPatchDetails, "mode" | "selectedFiles" | "hasChanges">;
};

export function requireSelectedFiles(files: string[]): string[] {
  const deduped = new Set<string>();
  for (const file of files) {
    const normalized = file.trim();
    if (normalized) {
      deduped.add(normalized);
    }
  }

  if (deduped.size === 0) {
    throw new Error(
      "files was provided, but no non-empty file paths remained after normalization.",
    );
  }
  return [...deduped];
}

function formatSummaryLine(fileChange: CodeDiffSummaryFile): string {
  if (fileChange.isBinary) {
    return `- ${fileChange.path} (binary)`;
  }
  return `- ${fileChange.path} (+${fileChange.addedLines} -${fileChange.removedLines})`;
}

export function buildSummaryResult(options: SummaryResultOptions) {
  if (options.changedFiles.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No changes found." }],
      details: {
        mode: "summary",
        ...options.detailsBase,
        files: options.changedFiles,
      } satisfies CodeDiffSummaryDetails,
    };
  }

  const lines = options.changedFiles.map((fileChange) => formatSummaryLine(fileChange));

  return {
    content: [{ type: "text" as const, text: ["Changed files:", ...lines].join("\n") }],
    details: {
      mode: "summary",
      ...options.detailsBase,
      files: options.changedFiles,
    } satisfies CodeDiffSummaryDetails,
  };
}

export function buildPatchResult(options: PatchResultOptions) {
  if (!options.patchText.trim()) {
    return {
      content: [{ type: "text" as const, text: "No changes in selected files." }],
      details: {
        mode: "patch",
        ...options.detailsBase,
        selectedFiles: options.selectedFiles,
        hasChanges: false,
      } satisfies CodeDiffPatchDetails,
    };
  }

  return {
    content: [{ type: "text" as const, text: options.patchText }],
    details: {
      mode: "patch",
      ...options.detailsBase,
      selectedFiles: options.selectedFiles,
      hasChanges: true,
    } satisfies CodeDiffPatchDetails,
  };
}
