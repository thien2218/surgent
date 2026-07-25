import type { InspectToolDetails, Range } from "./types.js";

export function parseInspectToolDetails(inspected: unknown) {
  if (!inspected || typeof inspected !== "object") return;

  const path = (inspected as { path?: unknown }).path;
  const symbol = (inspected as { symbol?: unknown }).symbol;
  const depth = (inspected as { depth?: unknown }).depth;
  const ranges = (inspected as { ranges?: unknown }).ranges;

  if (typeof path !== "string" || path.length === 0) return;
  if (typeof symbol !== "string" || symbol.length === 0) return;
  if (depth !== "full" && (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0)) {
    return;
  }
  if (!Array.isArray(ranges)) return;

  const parsedRanges: Range[] = [];
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) return;
    const start = range[0];
    const end = range[1];

    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start
    ) {
      return;
    }

    parsedRanges.push([start, end]);
  }

  return { path, symbol, depth, ranges: parsedRanges } satisfies InspectToolDetails;
}

export function pruneInspectResults(messages: Array<{ role?: string }>) {
  const seen = new Set<string>();
  let changed = false;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as {
      role: string;
      toolName?: string;
      details?: unknown;
      isError?: boolean;
    };

    if (message.role !== "toolResult" || message.toolName !== "inspect" || message.isError) {
      continue;
    }

    const details = parseInspectToolDetails(message.details);
    if (!details) continue;

    const symbolKey = `${details.path}#${details.symbol}`;
    if (!seen.has(symbolKey)) {
      seen.add(symbolKey);
      continue;
    }

    changed = true;
    messages.splice(index, 1);
  }

  return changed;
}
