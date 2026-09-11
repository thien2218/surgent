import { isDeepStrictEqual } from "node:util";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../utils.js";
import { hasFullCoverage } from "../optimizers/deduplicator/helpers.js";
import { getResourceCoverage } from "../optimizers/deduplicator/resources.js";
import type {
  EvidenceCall,
  ScoutEvidenceResult,
  ScoutResourceEvidence,
  ScoutSelector,
} from "./types.js";

const SCOUT_TOOLS = new Set(["code_map", "inspect", "read"]);

function parseScoutSelectors(output: string) {
  let entries: unknown;
  try {
    entries = JSON.parse(output);
  } catch {
    return { error: "Scout output must be a valid JSON array." };
  }
  if (!Array.isArray(entries)) return { error: "Scout output must be a JSON array." };

  const selectors: ScoutSelector[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) {
      return { error: `Scout output item ${index + 1} must be an object.` };
    }

    const keys = Object.keys(entry);
    if (keys.length !== 2 || !keys.includes("toolName") || !keys.includes("input")) {
      return {
        error: `Scout output item ${index + 1} must contain only toolName and input.`,
      };
    }
    if (typeof entry.toolName !== "string" || !SCOUT_TOOLS.has(entry.toolName)) {
      return { error: `Scout output item ${index + 1} has an invalid toolName.` };
    }
    if (!isRecord(entry.input)) {
      return { error: `Scout output item ${index + 1} input must be an object.` };
    }

    selectors.push({
      toolName: entry.toolName as ScoutSelector["toolName"],
      input: entry.input,
    });
  }
  return { selectors };
}

function collectEvidenceCalls(session: AgentSession): EvidenceCall[] {
  const callsById = new Map<string, EvidenceCall>();
  const calls: EvidenceCall[] = [];
  let order = 0;

  for (const message of session.messages) {
    if (message.role === "assistant") {
      for (const contentPart of message.content) {
        if (
          contentPart.type !== "toolCall" ||
          !SCOUT_TOOLS.has(contentPart.name) ||
          !isRecord(contentPart.arguments)
        ) {
          continue;
        }

        const call: EvidenceCall = {
          id: contentPart.id,
          toolName: contentPart.name as EvidenceCall["toolName"],
          input: contentPart.arguments,
          order,
        };
        order += 1;
        callsById.set(call.id, call);
        calls.push(call);
      }

      continue;
    }

    if (message.role !== "toolResult" || message.isError) continue;
    const call = callsById.get(message.toolCallId);
    if (!call || call.toolName !== message.toolName || message.content.length !== 1) continue;
    const contentPart = message.content[0];
    if (contentPart?.type !== "text") continue;

    call.output = contentPart.text;
    call.result = message;
  }
  return calls;
}

export function resolveScoutEvidence(
  session: AgentSession,
  selectorOutput: string,
  cwd: string,
): ScoutEvidenceResult {
  const parsed = parseScoutSelectors(selectorOutput);
  if (parsed.error) return { error: parsed.error };

  const calls = collectEvidenceCalls(session);
  const selected: EvidenceCall[] = [];

  for (const selector of parsed.selectors ?? []) {
    const call = calls.findLast(
      (candidate) =>
        candidate.output !== undefined &&
        candidate.toolName === selector.toolName &&
        isDeepStrictEqual(candidate.input, selector.input),
    );
    if (!call) {
      return {
        error: `Scout ${selector.toolName} output item does not match a successful tool call.`,
      };
    }
    selected.push(call);
  }

  selected.sort((firstCall, secondCall) => firstCall.order - secondCall.order);
  const retained: EvidenceCall[] = [];
  const retainedCoverage = new Map<string, [number, number][]>();
  const evidence: ScoutResourceEvidence[] = [];

  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const call = selected[index]!;
    const coverage = getResourceCoverage(call.toolName, call.input, call.result, cwd);
    if (
      coverage &&
      hasFullCoverage(coverage.range, retainedCoverage.get(coverage.resource) ?? [])
    ) {
      continue;
    }

    retained.push(call);
    if (!coverage) continue;

    const ranges = retainedCoverage.get(coverage.resource) ?? [];
    ranges.push(coverage.range);
    retainedCoverage.set(coverage.resource, ranges);

    evidence.push({
      toolName: call.toolName as "inspect" | "read",
      resource: coverage.resource,
      range: coverage.range,
    });
  }

  return {
    output: JSON.stringify(retained.map((call) => ({ input: call.input, output: call.output }))),
    evidence,
  };
}
