import type { CodeDiffSummaryFile, SourceSelector, SourceSelectorInput } from "./types.js";

export function parseSourceSelector(source: SourceSelectorInput): SourceSelector {
  const normalizedHash = source.hash?.trim();
  const hasPr = source.pr !== undefined;
  const hasHash = normalizedHash !== undefined;

  if (source.uncommitted === false) {
    throw new Error("source.uncommitted must be true when provided.");
  }

  const hasUncommitted = source.uncommitted === true;
  const selectorCount = [hasPr, hasHash, hasUncommitted].filter(Boolean).length;

  if (selectorCount !== 1) {
    throw new Error(
      "source must include exactly one populated selector: source.pr or source.hash or source.uncommitted.",
    );
  }

  if (hasPr) {
    const prNumber = source.pr as number;
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(`source.pr must be a positive integer. Received: ${source.pr}`);
    }
    return { kind: "pr", value: prNumber };
  }
  if (hasHash) {
    return { kind: "hash", value: normalizedHash as string };
  }
  return { kind: "uncommitted" };
}

export function getSourceLabel(sourceSelector: SourceSelector): string {
  if (sourceSelector.kind === "pr") {
    return `pr:${sourceSelector.value}`;
  }
  if (sourceSelector.kind === "hash") {
    return `hash:${sourceSelector.value}`;
  }
  return "uncommitted";
}

export function isHashCandidate(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

function parseNumstatCount(rawCount: string): number | null {
  if (rawCount === "-") return null;
  const parsedCount = Number.parseInt(rawCount, 10);
  return Number.isFinite(parsedCount) ? parsedCount : null;
}

export function parseNumstatLine(rawLine: string): CodeDiffSummaryFile | null {
  const columns = rawLine.split("\t");
  if (columns.length < 3) return null;

  const rawAdded = columns[0]!.trim();
  const rawRemoved = columns[1]!.trim();
  const path = columns.slice(2).join("\t").trim();
  if (!path) return null;

  const addedLines = parseNumstatCount(rawAdded);
  const removedLines = parseNumstatCount(rawRemoved);

  return {
    path,
    addedLines,
    removedLines,
    isBinary: addedLines === null || removedLines === null,
  };
}

export function describeSourceForRender(source: unknown): string {
  if (!source || typeof source !== "object") {
    return "source";
  }

  const sourceRecord = source as Record<string, unknown>;
  if (sourceRecord.pr !== undefined) {
    return `pr:${sourceRecord.pr}`;
  }
  if (typeof sourceRecord.hash === "string") {
    return `hash:${sourceRecord.hash}`;
  }
  if (sourceRecord.uncommitted === true) {
    return "uncommitted";
  }

  return "source";
}

function getDiffFilePaths(diffHeaderLine: string): { oldPath: string; newPath: string } | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(diffHeaderLine);
  if (!match) {
    return null;
  }

  return { oldPath: match[1] as string, newPath: match[2] as string };
}

export function filterPatchByFiles(patchText: string, selectedFiles: string[]): string {
  if (!patchText.trim()) return "";

  const selectedFileSet = new Set(selectedFiles);
  const patchLines = patchText.split(/\r?\n/);
  const keptSections: string[] = [];

  let sectionLines: string[] = [];
  let sectionPaths: { oldPath: string; newPath: string } | null = null;

  const flushSection = () => {
    if (sectionLines.length === 0 || !sectionPaths) {
      sectionLines = [];
      sectionPaths = null;
      return;
    }

    const shouldKeep =
      selectedFileSet.has(sectionPaths.oldPath) || selectedFileSet.has(sectionPaths.newPath);
    if (shouldKeep) {
      keptSections.push(sectionLines.join("\n"));
    }

    sectionLines = [];
    sectionPaths = null;
  };

  for (const patchLine of patchLines) {
    if (patchLine.startsWith("diff --git ")) {
      flushSection();
      sectionPaths = getDiffFilePaths(patchLine);
      sectionLines = [patchLine];
      continue;
    }

    if (sectionLines.length > 0) {
      sectionLines.push(patchLine);
    }
  }

  flushSection();
  return keptSections.join("\n").trim();
}
