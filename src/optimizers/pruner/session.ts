import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFailedToolCallState } from "./cleanup.js";
import { getLastEntryId, isRecord } from "./entries.js";
import { pruneEntries } from "./prune.js";

export function readSessionEntries(sessionFile: string): Record<string, unknown>[] | undefined {
  if (!existsSync(sessionFile)) return;

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

function getSessionCwd(entries: Record<string, unknown>[], fallbackCwd: string): string {
  for (const entry of entries) {
    if (entry.type === "session" && typeof entry.cwd === "string" && entry.cwd.length > 0) {
      return entry.cwd;
    }
  }
  return fallbackCwd;
}

function writeSessionEntries(sessionFile: string, entries: Record<string, unknown>[]) {
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

export function rewritePrunedSessionFile(
  sessionFile: string,
  leafId: string | null,
  fallbackCwd: string,
  useLastEntryWhenLeafMissing: boolean,
) {
  const entries = readSessionEntries(sessionFile);
  if (!entries) return;

  const effectiveLeafId = leafId ?? (useLastEntryWhenLeafMissing ? getLastEntryId(entries) : null);
  const pruned = pruneEntries(entries, effectiveLeafId, getSessionCwd(entries, fallbackCwd));
  const addedFailedCallState = appendFailedToolCallState(
    pruned.entries,
    pruned.failedToolCallIds,
    pruned.activeLeafId,
  );
  if (!pruned.changed && !addedFailedCallState) return;
  writeSessionEntries(sessionFile, pruned.entries);
}
