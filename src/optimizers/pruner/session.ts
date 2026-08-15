import { getLastEntryId, readSessionEntries, writeSessionEntries } from "../entries.js";
import { removeEntries } from "./cleanup.js";
import type { PruneEntriesResult } from "./types.js";

function pruneEntries(
  entries: Record<string, unknown>[],
  leafId: string | null,
): PruneEntriesResult {
  const entryRemoval = removeEntries(entries);
  let activeLeafId = leafId;
  while (activeLeafId && entryRemoval.replacementParents.has(activeLeafId)) {
    activeLeafId = entryRemoval.replacementParents.get(activeLeafId) ?? null;
  }

  return {
    activeLeafId,
    changed: entryRemoval.changed,
    entries: entryRemoval.entries,
  };
}

export function rewritePrunedSessionFile(
  sessionFile: string,
  leafId: string | null,
  fallbackToLastEntry: boolean,
) {
  const entries = readSessionEntries(sessionFile);
  if (!entries) return;

  const effectiveLeafId = leafId ?? (fallbackToLastEntry ? getLastEntryId(entries) : null);
  const pruned = pruneEntries(entries, effectiveLeafId);
  if (!pruned.changed) return;
  writeSessionEntries(sessionFile, pruned.entries);
}
