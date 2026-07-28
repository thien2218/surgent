import { realpathSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { parseInspectToolDetails } from "../inspector/helpers.js";
import { removeFailedEntries } from "./cleanup.js";
import {
  getBranchEntries,
  getDetails,
  getEntryId,
  getMessage,
  getRepeatIds,
  getToolResultMessage,
  isRecord,
} from "./entries.js";
import type { PruneEntriesResult, ResourceResult } from "./types.js";

function clearRepeat(entry: Record<string, unknown>): boolean {
  const message = getToolResultMessage(entry);
  const details = message ? getDetails(message) : undefined;
  if (!message || !details || !("repeat" in details)) return false;

  const updatedDetails = { ...details };
  delete updatedDetails.repeat;
  entry.message = { ...message, details: updatedDetails };
  return true;
}

function setRepeat(entry: Record<string, unknown>, repeat: string | string[]): boolean {
  const message = getToolResultMessage(entry);
  if (!message) return false;

  const details = getDetails(message);
  entry.message = {
    ...message,
    details: {
      ...(details ?? {}),
      repeat,
    },
  };
  return true;
}

function restoreOriginalContent(entry: Record<string, unknown>): boolean {
  const message = getToolResultMessage(entry);
  const details = message ? getDetails(message) : undefined;
  if (!message || !details || typeof details.originalContent !== "string") return false;

  const updatedDetails = { ...details };
  delete updatedDetails.originalContent;
  entry.message = {
    ...message,
    content: [{ type: "text", text: details.originalContent }],
    details: updatedDetails,
  };
  return true;
}

function collectToolCallInputs(
  activeEntries: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const inputsByToolCallId = new Map<string, Record<string, unknown>>();
  for (const entry of activeEntries) {
    const message = getMessage(entry);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "toolCall") continue;
      if (typeof block.id !== "string" || !isRecord(block.arguments)) continue;
      inputsByToolCallId.set(block.id, block.arguments);
    }
  }
  return inputsByToolCallId;
}

function getResultText(message: Record<string, unknown>): string | undefined {
  const originalContent = getDetails(message)?.originalContent;
  if (typeof originalContent === "string") return originalContent;
  if (!Array.isArray(message.content) || message.content.length !== 1) return;

  const content = message.content[0];
  if (!isRecord(content)) return;
  if (content.type !== "text" || typeof content.text !== "string") return;
  return content.text;
}

function getReadRange(
  message: Record<string, unknown>,
  input: Record<string, unknown>,
): { path: string; range: [number, number] } | undefined {
  const path = input.path;
  const offset = input.offset;
  if (typeof path !== "string" || path.length === 0) return;
  if (
    offset !== undefined &&
    (typeof offset !== "number" || !Number.isInteger(offset) || offset < 1)
  ) {
    return;
  }

  const details = getDetails(message);
  const truncation = details?.truncation;
  if (truncation !== undefined && !isRecord(truncation)) return;
  if (truncation?.firstLineExceedsLimit === true) return;

  const resultText = getResultText(message);
  if (resultText === undefined) return;
  const continuation = resultText.match(/\n\n\[[^\n]*Use offset=\d+ to continue\.\]$/)?.[0];
  const visibleText = continuation ? resultText.slice(0, -continuation.length) : resultText;
  const outputLines =
    truncation?.truncated === true ? truncation.outputLines : visibleText.split("\n").length;
  if (typeof outputLines !== "number" || !Number.isInteger(outputLines) || outputLines <= 0) return;

  const start = typeof offset === "number" ? offset : 1;
  return { path, range: [start, start + outputLines - 1] };
}

function normalizeResourcePath(sourcePath: string, cwd: string): string {
  const absolutePath = resolve(cwd, sourcePath);
  try {
    return normalize(realpathSync(absolutePath));
  } catch {
    return normalize(absolutePath);
  }
}

function collectResourceResults(
  activeEntries: Record<string, unknown>[],
  inputsByToolCallId: Map<string, Record<string, unknown>>,
  cwd: string,
): ResourceResult[] {
  const resourceResults: ResourceResult[] = [];
  for (const entry of activeEntries) {
    const entryId = getEntryId(entry);
    const message = getToolResultMessage(entry);
    if (!entryId || !message || message.isError === true) continue;

    if (message.toolName === "read") {
      const input = inputsByToolCallId.get(message.toolCallId as string);
      if (!input) continue;
      const read = getReadRange(message, input);
      if (!read) continue;
      resourceResults.push({
        entry,
        entryId,
        kind: "read",
        range: read.range,
        resource: normalizeResourcePath(read.path, cwd),
      });
      continue;
    }

    if (message.toolName !== "inspect") continue;
    const inspected = parseInspectToolDetails(message.details);
    if (!inspected) continue;
    resourceResults.push({
      entry,
      entryId,
      kind: "inspect",
      resource: `${normalizeResourcePath(inspected.path, cwd)}\u0000${inspected.symbol}`,
    });
  }
  return resourceResults;
}

function hasFullCoverage(range: [number, number], candidates: ResourceResult[]): boolean {
  const intersections: [number, number][] = [];
  for (const candidate of candidates) {
    if (!candidate.range) continue;
    const start = Math.max(range[0], candidate.range[0]);
    const end = Math.min(range[1], candidate.range[1]);
    if (start <= end) intersections.push([start, end]);
  }
  if (intersections.length === 0) return false;

  intersections.sort(([firstStart], [secondStart]) => firstStart - secondStart);
  let coveredLines = 0;
  let coveredStart = intersections[0]![0];
  let coveredEnd = intersections[0]![1];
  for (const [start, end] of intersections.slice(1)) {
    if (start > coveredEnd + 1) {
      coveredLines += coveredEnd - coveredStart + 1;
      coveredStart = start;
      coveredEnd = end;
      continue;
    }
    coveredEnd = Math.max(coveredEnd, end);
  }
  coveredLines += coveredEnd - coveredStart + 1;
  return coveredLines === range[1] - range[0] + 1;
}

function linkSupersededResults(resourceResults: ResourceResult[]): boolean {
  const latestInspectByResource = new Map<string, ResourceResult>();
  const retainedReadsByResource = new Map<string, ResourceResult[]>();
  let changed = false;

  for (let index = resourceResults.length - 1; index >= 0; index -= 1) {
    const resourceResult = resourceResults[index]!;
    if (resourceResult.kind === "inspect") {
      const replacement = latestInspectByResource.get(resourceResult.resource);
      if (replacement) {
        changed = setRepeat(resourceResult.entry, replacement.entryId) || changed;
      } else {
        latestInspectByResource.set(resourceResult.resource, resourceResult);
      }
      continue;
    }

    if (!resourceResult.range) continue;
    const retainedReads = retainedReadsByResource.get(resourceResult.resource) ?? [];
    const coveringReads = retainedReads.filter(
      (candidate) =>
        candidate.range &&
        candidate.range[0] <= resourceResult.range![1] &&
        candidate.range[1] >= resourceResult.range![0],
    );
    if (hasFullCoverage(resourceResult.range, coveringReads)) {
      changed =
        setRepeat(
          resourceResult.entry,
          coveringReads.map((candidate) => candidate.entryId),
        ) || changed;
      continue;
    }
    retainedReads.push(resourceResult);
    retainedReadsByResource.set(resourceResult.resource, retainedReads);
  }

  return changed;
}

function restoreReplacementContent(resourceResults: ResourceResult[]): boolean {
  const replacementIds = new Set<string>();
  for (const resourceResult of resourceResults) {
    const message = getToolResultMessage(resourceResult.entry);
    if (!message) continue;
    for (const repeatId of getRepeatIds(message) ?? []) replacementIds.add(repeatId);
  }

  let changed = false;
  for (const resourceResult of resourceResults) {
    if (!replacementIds.has(resourceResult.entryId)) continue;
    changed = restoreOriginalContent(resourceResult.entry) || changed;
  }
  return changed;
}

export function pruneEntries(
  entries: Record<string, unknown>[],
  leafId: string | null,
  cwd: string,
): PruneEntriesResult {
  const failedEntryRemoval = removeFailedEntries(entries);
  let activeLeafId = leafId;
  while (activeLeafId && failedEntryRemoval.replacementParents.has(activeLeafId)) {
    activeLeafId = failedEntryRemoval.replacementParents.get(activeLeafId) ?? null;
  }

  const activeEntries = getBranchEntries(failedEntryRemoval.entries, activeLeafId);
  const inputsByToolCallId = collectToolCallInputs(activeEntries);
  const resourceResults = collectResourceResults(activeEntries, inputsByToolCallId, cwd);
  let changed = failedEntryRemoval.changed;

  for (const resourceResult of resourceResults) {
    changed = clearRepeat(resourceResult.entry) || changed;
  }
  changed = linkSupersededResults(resourceResults) || changed;
  changed = restoreReplacementContent(resourceResults) || changed;

  return {
    activeLeafId,
    changed,
    entries: failedEntryRemoval.entries,
    failedToolCallIds: [...failedEntryRemoval.failedToolCallIds],
  };
}
