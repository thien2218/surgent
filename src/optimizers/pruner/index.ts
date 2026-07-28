import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildPrunerState, emptyPrunerState, filterContextMessages } from "./context.js";
import { getLastEntryId } from "./entries.js";
import { readSessionEntries, rewritePrunedSessionFile } from "./session.js";
import type { PrunerState } from "./types.js";

function loadPrunerState(sessionFile: string | undefined, leafId: string | null): PrunerState {
  if (!sessionFile) return emptyPrunerState();
  const entries = readSessionEntries(sessionFile);
  if (!entries) return emptyPrunerState();

  const currentState = buildPrunerState(entries, leafId);
  if (currentState.resultEntryIds.size > 0 || leafId === null) return currentState;
  return buildPrunerState(entries, getLastEntryId(entries));
}

export default function (pi: ExtensionAPI) {
  let activeLeafId: string | null = null;
  let activeSessionFile: string | undefined;
  let state = emptyPrunerState();

  pi.on("session_start", (_event, ctx) => {
    activeSessionFile = ctx.sessionManager.getSessionFile();
    activeLeafId = ctx.sessionManager.getLeafId();
    state = loadPrunerState(activeSessionFile, activeLeafId);
  });

  pi.on("session_tree", (event, ctx) => {
    activeSessionFile = ctx.sessionManager.getSessionFile();
    activeLeafId = event.newLeafId;
    state = loadPrunerState(activeSessionFile, activeLeafId);
  });

  pi.on("session_shutdown", (event, ctx) => {
    const sessionFiles = new Map<string, { leafId: string | null; useLastEntry: boolean }>();
    if (activeSessionFile) {
      sessionFiles.set(activeSessionFile, { leafId: activeLeafId, useLastEntry: false });
    }
    if (event.targetSessionFile && !sessionFiles.has(event.targetSessionFile)) {
      sessionFiles.set(event.targetSessionFile, { leafId: null, useLastEntry: true });
    }

    for (const [sessionFile, options] of sessionFiles) {
      rewritePrunedSessionFile(sessionFile, options.leafId, ctx.cwd, options.useLastEntry);
    }
  });

  pi.on("context", (event) => {
    const pruned = filterContextMessages(event.messages, state);
    if (pruned.changed) return { messages: pruned.messages };
  });
}
