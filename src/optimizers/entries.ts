import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isRecord } from "../utils.js";

export function readSessionEntries(
  sessionFile: string | undefined,
): Record<string, unknown>[] | undefined {
  if (!sessionFile || !existsSync(sessionFile)) return;

  try {
    const sessionText = readFileSync(sessionFile, "utf8");
    const entries: Record<string, unknown>[] = [];
    for (const line of sessionText.split("\n")) {
      if (line.trim().length === 0) continue;
      const entry = JSON.parse(line);
      if (!isRecord(entry)) return;
      entries.push(entry);
    }
    return entries;
  } catch {
    return;
  }
}

export function writeSessionEntries(sessionFile: string, entries: Record<string, unknown>[]) {
  const temporaryFile = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(
      temporaryFile,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    renameSync(temporaryFile, sessionFile);
  } finally {
    if (existsSync(temporaryFile)) unlinkSync(temporaryFile);
  }
}

export function getEntryId(entry: Record<string, unknown>): string | undefined {
  const entryId = entry.id;
  if (typeof entryId !== "string" || entryId.length === 0) return;
  return entryId;
}

export function getMessage(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  if (entry.type !== "message") return;
  const message = entry.message;
  if (!isRecord(message)) return;
  return message;
}

export function getToolResultMessage(
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const message = getMessage(entry);
  if (!message || message.role !== "toolResult") return;
  if (typeof message.toolCallId !== "string" || message.toolCallId.length === 0) return;
  if (typeof message.toolName !== "string" || message.toolName.length === 0) return;
  return message;
}

export function getDetails(message: Record<string, unknown>): Record<string, unknown> | undefined {
  const details = message.details;
  if (!isRecord(details)) return;
  return details;
}

export function getParentId(entry: Record<string, unknown>): string | null {
  if (typeof entry.parentId === "string") return entry.parentId;
  return null;
}

export function getBranchEntries(
  entries: Record<string, unknown>[],
  leafId: string | null,
): Record<string, unknown>[] {
  if (!leafId) return [];

  const entriesById = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const entryId = getEntryId(entry);
    if (entryId) entriesById.set(entryId, entry);
  }
  if (!entriesById.has(leafId)) return [];

  const branch: Record<string, unknown>[] = [];
  const visitedIds = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId && !visitedIds.has(currentId)) {
    const entry = entriesById.get(currentId);
    if (!entry) break;
    visitedIds.add(currentId);
    branch.push(entry);
    currentId = getParentId(entry);
  }
  return branch.reverse();
}

export function getLastEntryId(entries: Record<string, unknown>[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entryId = getEntryId(entries[index]!);
    if (entryId) return entryId;
  }
  return null;
}
