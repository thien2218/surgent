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
import { hasFullCoverage } from "./helpers.js";
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
      range: inspected.range,
      resource: normalizeResourcePath(inspected.path, cwd),
      toolCallId: message.toolCallId,
    });
  }
  return resourceResults;
}

function collectReplacementIds(resourceResults: ResourceResult[]): Map<string, string[]> {
  const retainedByResource = new Map<string, ResourceResult[]>();
  const replacementIdsByEntryId = new Map<string, string[]>();

  for (let index = resourceResults.length - 1; index >= 0; index -= 1) {
    const resourceResult = resourceResults[index]!;
    const retainedResults = retainedByResource.get(resourceResult.resource) ?? [];
    const coveringResults = retainedResults.filter(
      (candidate) =>
        candidate.range[0] <= resourceResult.range[1] &&
        candidate.range[1] >= resourceResult.range[0],
    );
    if (hasFullCoverage(resourceResult.range, coveringResults.map((candidate) => candidate.range))) {
      replacementIdsByEntryId.set(
        resourceResult.entryId,
        coveringResults.map((candidate) => candidate.entryId),
      );
      continue;
    }
    retainedResults.push(resourceResult);
    retainedByResource.set(resourceResult.resource, retainedResults);
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
