import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildPrunerState, emptyPrunerState, filterContextMessages } from "./context.js";
import { getLastEntryId } from "../entries.js";
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
  let state = emptyPrunerState();

  pi.on("session_start", (_event, ctx) => {
    state = loadPrunerState(ctx.sessionManager.getSessionFile(), ctx.sessionManager.getLeafId());
  });

  pi.on("session_tree", (event, ctx) => {
    state = loadPrunerState(ctx.sessionManager.getSessionFile(), event.newLeafId);
  });

  pi.on("session_shutdown", (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) {
      rewritePrunedSessionFile(sessionFile, ctx.sessionManager.getLeafId(), ctx.cwd, false);
    }
    if (event.targetSessionFile && event.targetSessionFile !== sessionFile) {
      rewritePrunedSessionFile(event.targetSessionFile, null, ctx.cwd, true);
    }
  });

  pi.on("context", (event) => {
    const pruned = filterContextMessages(event.messages, state);
    if (pruned.changed) return { messages: pruned.messages };
  });
}
