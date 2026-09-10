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
    if (!input) continue;
    if (message.toolName === "read" || message.toolName === "inspect") {
      const coverage = getResourceCoverage(message.toolName, input, message, cwd);
      if (!coverage) continue;
      results.push({
        entryId,
        range: coverage.range,
        resource: coverage.resource,
        toolCallId: message.toolCallId,
        prunable: true,
      });
      continue;
    }

    if (message.toolName !== "subagent" || input.agent !== "scout") continue;
    const evidence = getDetails(message)?.evidence;
    if (!Array.isArray(evidence)) continue;

    for (const item of evidence) {
      if (!isRecord(item) || (item.toolName !== "read" && item.toolName !== "inspect")) {
        continue;
      }
      if (typeof item.resource !== "string" || item.resource.length === 0) continue;
      if (!Array.isArray(item.range) || item.range.length !== 2) continue;

      const start = item.range[0];
      const end = item.range[1];
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start
      ) {
        continue;
      }

      results.push({
        entryId,
        range: [start, end],
        resource: item.resource,
        toolCallId: message.toolCallId,
        prunable: false,
      });
    }
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
