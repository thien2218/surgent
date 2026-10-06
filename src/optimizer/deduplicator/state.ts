import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { hasFullCoverage } from "./helpers.js";
import { getResourceCoverage } from "./resources.js";
import type { Range } from "../inspector/types.js";

interface ResourceResult {
  entryId: string;
  range: Range;
  resource: string;
}

function collectToolCallInputs(
  entries: ProjectedSessionEntry[],
): Map<string, Record<string, unknown>> {
  const inputsByCallId = new Map<string, Record<string, unknown>>();

  for (const { sourceEntry } of entries) {
    if (sourceEntry.type !== "message" || sourceEntry.message.role !== "assistant") continue;
    for (const block of sourceEntry.message.content) {
      if (block.type === "toolCall") inputsByCallId.set(block.id, block.arguments);
    }
  }

  return inputsByCallId;
}

function collectResourceResults(
  entries: ProjectedSessionEntry[],
  inputsByCallId: Map<string, Record<string, unknown>>,
  cwd: string,
): ResourceResult[] {
  const results: ResourceResult[] = [];
  for (const entry of entries) {
    const message = getEligibleResult(entry);
    if (!message || message.isError) continue;

    const input = inputsByCallId.get(message.toolCallId);
    if (!input) continue;

    const coverage = getResourceCoverage(message.toolName, input, message, cwd);
    if (!coverage) continue;

    results.push({ entryId: entry.sourceEntry.id, ...coverage });
  }
  return results;
}

function collectReplacementsById(results: ResourceResult[]): Map<string, string[]> {
  const retainedByResource = new Map<string, ResourceResult[]>();
  const replacements = new Map<string, string[]>();

  for (let idx = results.length - 1; idx >= 0; idx -= 1) {
    const result = results[idx]!;
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
      replacements.set(
        result.entryId,
        covering.map((candidate) => candidate.entryId),
      );
      continue;
    }

    retained.push(result);
    retainedByResource.set(result.resource, retained);
  }

  return replacements;
}

export function buildDeduplicatorState(entries: ProjectedSessionEntry[], cwd: string) {
  return collectReplacementsById(
    collectResourceResults(entries, collectToolCallInputs(entries), cwd),
  );
}
