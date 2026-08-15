import { realpathSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { parseInspectToolDetails } from "../inspector/helpers.js";
import {
  getBranchEntries,
  getDetails,
  getEntryId,
  getLastEntryId,
  getMessage,
  getToolResultMessage,
} from "../entries.js";
import { isRecord } from "../../utils.js";
import type { DeduplicatorState, ResourceResult } from "./types.js";

function collectToolCallInputs(
  activeEntries: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const inputsByCallId = new Map<string, Record<string, unknown>>();
  for (const entry of activeEntries) {
    const message = getMessage(entry);
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "toolCall") continue;
      if (typeof block.id !== "string" || !isRecord(block.arguments)) continue;
      inputsByCallId.set(block.id, block.arguments);
    }
  }
  return inputsByCallId;
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
  inputsByCallId: Map<string, Record<string, unknown>>,
  cwd: string,
): ResourceResult[] {
  const resourceResults: ResourceResult[] = [];
  for (const entry of activeEntries) {
    const entryId = getEntryId(entry);
    const message = getToolResultMessage(entry);
    if (
      !entryId ||
      !message ||
      message.isError === true ||
      typeof message.toolCallId !== "string"
    ) {
      continue;
    }

    if (message.toolName === "read") {
      const input = inputsByCallId.get(message.toolCallId as string);
      if (!input) continue;
      const read = getReadRange(message, input);
      if (!read) continue;
      resourceResults.push({
        entry,
        entryId,
        kind: "read",
        range: read.range,
        resource: normalizeResourcePath(read.path, cwd),
        toolCallId: message.toolCallId,
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
      toolCallId: message.toolCallId,
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

function collectReplacementIds(resourceResults: ResourceResult[]): Map<string, string[]> {
  const latestInspectByResource = new Map<string, ResourceResult>();
  const retainedReadsByResource = new Map<string, ResourceResult[]>();
  const replacementIdsByEntryId = new Map<string, string[]>();

  for (let index = resourceResults.length - 1; index >= 0; index -= 1) {
    const resourceResult = resourceResults[index]!;
    if (resourceResult.kind === "inspect") {
      const replacement = latestInspectByResource.get(resourceResult.resource);
      if (replacement) {
        replacementIdsByEntryId.set(resourceResult.entryId, [replacement.entryId]);
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
      replacementIdsByEntryId.set(
        resourceResult.entryId,
        coveringReads.map((candidate) => candidate.entryId),
      );
      continue;
    }
    retainedReads.push(resourceResult);
    retainedReadsByResource.set(resourceResult.resource, retainedReads);
  }

  return replacementIdsByEntryId;
}

export function buildDeduplicatorState(
  entries: Record<string, unknown>[],
  leafId: string | null,
  cwd: string,
): DeduplicatorState {
  let activeEntries = getBranchEntries(entries, leafId);
  if (activeEntries.length === 0 && leafId !== null) {
    activeEntries = getBranchEntries(entries, getLastEntryId(entries));
  }

  const resourceResults = collectResourceResults(
    activeEntries,
    collectToolCallInputs(activeEntries),
    cwd,
  );
  const replacementIdsByEntryId = collectReplacementIds(resourceResults);
  const resourceResultsByEntryId = new Map(
    resourceResults.map((resourceResult) => [resourceResult.entryId, resourceResult]),
  );
  const replacementsByCallId = new Map<string, string[]>();
  const replacementToolCallIds = new Set<string>();

  for (const resourceResult of resourceResults) {
    const replacementIds = replacementIdsByEntryId.get(resourceResult.entryId);
    if (!replacementIds) continue;
    replacementsByCallId.set(resourceResult.toolCallId, replacementIds);

    for (const replacementId of replacementIds) {
      const replacement = resourceResultsByEntryId.get(replacementId);
      if (replacement) replacementToolCallIds.add(replacement.toolCallId);
    }
  }

  return {
    replacementsByCallId,
    replacementToolCallIds,
    resultEntryIds: new Set(resourceResultsByEntryId.keys()),
  };
}
