import type { InspectToolDetails } from "./types.js";

export function parseInspectToolDetails(inspected: unknown) {
  if (!inspected || typeof inspected !== "object") return;

  const path = (inspected as { path?: unknown }).path;
  const symbol = (inspected as { symbol?: unknown }).symbol;
  const depth = (inspected as { depth?: unknown }).depth;
  const lines = (inspected as { lines?: unknown }).lines;

  if (typeof path !== "string" || path.length === 0) return;
  if (typeof symbol !== "string" || symbol.length === 0) return;
  if (depth !== "full" && (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0)) {
    return;
  }
  if (!Array.isArray(lines) || lines.length !== 2) return;

  const startLine = lines[0];
  const endLine = lines[1];

  if (
    typeof startLine !== "number" ||
    typeof endLine !== "number" ||
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine)
  ) {
    return;
  }

  return { path, symbol, depth, lines: [startLine, endLine] } satisfies InspectToolDetails;
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
