import {
  getBranchEntries,
  getEntryId,
  getLastEntryId,
  getMessage,
  getToolResultMessage,
} from "../entries.js";
import { isRecord } from "../../utils.js";
import { hasFullCoverage } from "./helpers.js";
import { getResourceCoverage } from "./resources.js";
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

function collectResourceResults(
  activeEntries: Record<string, unknown>[],
  inputsByCallId: Map<string, Record<string, unknown>>,
  cwd: string,
): ResourceResult[] {
  const results: ResourceResult[] = [];
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

    const input = inputsByCallId.get(message.toolCallId);
    if (!input || (message.toolName !== "read" && message.toolName !== "inspect")) continue;

    const coverage = getResourceCoverage(message.toolName, input, message, cwd);
    if (!coverage) continue;
    results.push({
      entryId,
      range: coverage.range,
      resource: coverage.resource,
      toolCallId: message.toolCallId,
      prunable: true,
    });
  }
  return results;
}

function collectReplacementsById(results: ResourceResult[]): Map<string, string[]> {
  const retainedByResource = new Map<string, ResourceResult[]>();
  const replacementsById = new Map<string, string[]>();

  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index]!;
    const retained = retainedByResource.get(result.resource) ?? [];
    const covering = retained.filter(
      (candidate) => candidate.range[0] <= result.range[1] && candidate.range[1] >= result.range[0],
    );

    if (
      hasFullCoverage(
        result.range,
        covering.map(({ range }) => range),
      )
    ) {
      if (result.prunable) {
        replacementsById.set(result.entryId, [
          ...new Set(covering.map((candidate) => candidate.entryId)),
        ]);
      }
      continue;
    }
    retained.push(result);
    retainedByResource.set(result.resource, retained);
  }

  return replacementsById;
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

  const results = collectResourceResults(activeEntries, collectToolCallInputs(activeEntries), cwd);
  const replacementsById = collectReplacementsById(results);
  const replacements = new Map<string, string[]>();

  for (const result of results) {
    if (!result.prunable) continue;
    const replacement = replacementsById.get(result.entryId);
    if (!replacement) continue;
    replacements.set(result.toolCallId, replacement);
  }

  return { replacements, resultEntryIds: new Set(results.map((result) => result.entryId)) };
}
