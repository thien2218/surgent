import type { InspectToolDetails, ParsedInspectorId } from "./types.js";

export function parseInspectorId(id: string) {
  const trimmedId = id.trim();
  const separatorIndex = trimmedId.indexOf("#");
  if (separatorIndex <= 0 || separatorIndex >= trimmedId.length - 1) return;

  const path = trimmedId.slice(0, separatorIndex).trim().replaceAll("\\", "/");
  const symbolPart = trimmedId.slice(separatorIndex + 1).trim();
  if (path.length === 0 || symbolPart.length === 0) return;

  const suffixMatch = symbolPart.match(/~(\d+)$/);
  let name = symbolPart;

  if (suffixMatch) {
    const occurrenceText = suffixMatch[1];
    if (!occurrenceText) return;

    const occurrence = Number(occurrenceText);
    if (!Number.isInteger(occurrence) || occurrence < 1) return;

    name = symbolPart.slice(0, -suffixMatch[0].length);
    if (name.length === 0) return;
  }

  const suffix = suffixMatch ? Number(suffixMatch[1]) : null;
  const orginal = suffix ? `${path}#${name}~${suffix}` : `${path}#${name}`;

  return { orginal, path, name, suffix } satisfies ParsedInspectorId;
}

export function parseInspectToolDetails(inspected: unknown) {
  if (!inspected || typeof inspected !== "object") return;

  const id = (inspected as { id?: unknown }).id;
  const depth = (inspected as { depth?: unknown }).depth;
  const lines = (inspected as { lines?: unknown }).lines;

  if (typeof id !== "string" || id.length === 0) return;
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

  return { id, depth, lines: [startLine, endLine] } satisfies InspectToolDetails;
}

export function pruneInspectResults(messages: Array<{ role?: string }>) {
  const seenInspectIds = new Set<string>();
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

    const inspectedId = details.id;
    if (!seenInspectIds.has(inspectedId)) {
      seenInspectIds.add(inspectedId);
      continue;
    }

    changed = true;
    messages.splice(index, 1);
  }

  return changed;
}
