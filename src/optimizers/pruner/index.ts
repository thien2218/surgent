import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getRemovedToolCallId } from "./cleanup.js";
import { buildPrunerState, filterContextMessages } from "./context.js";
import { readSessionEntries } from "../entries.js";
import { rewritePrunedSessionFile } from "./session.js";

function loadPrunerState(sessionFile: string | undefined): Set<string> {
  const entries = readSessionEntries(sessionFile);
  return entries ? buildPrunerState(entries) : new Set<string>();
}

export default function (pi: ExtensionAPI) {
  let state = new Set<string>();

  pi.on("session_start", (_event, ctx) => {
    state = loadPrunerState(ctx.sessionManager.getSessionFile());
  });

  pi.on("session_tree", (_event, ctx) => {
    state = loadPrunerState(ctx.sessionManager.getSessionFile());
  });

  pi.on("agent_end", (event) => {
    for (const message of event.messages) {
      if (message.role !== "toolResult") continue;
      const toolCallId = getRemovedToolCallId(message);
      if (toolCallId) state.add(toolCallId);
    }
  });

  pi.on("session_shutdown", (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) {
      rewritePrunedSessionFile(sessionFile, ctx.sessionManager.getLeafId(), false);
    }
    if (event.targetSessionFile && event.targetSessionFile !== sessionFile) {
      rewritePrunedSessionFile(event.targetSessionFile, null, true);
    }
  });

  pi.on("context", (event) => {
    const pruned = filterContextMessages(event.messages, state);
    if (pruned.changed) return { messages: pruned.messages };
  });
}
