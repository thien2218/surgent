import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readSessionEntries } from "../entries.js";
import { filterDeduplicatedMessages } from "./helpers.js";
import { buildDeduplicatorState } from "./state.js";

export default function (pi: ExtensionAPI) {
  let state = buildDeduplicatorState([], null, "");

  pi.on("session_start", (_event, ctx) => {
    const entries = readSessionEntries(ctx.sessionManager.getSessionFile()) ?? [];
    state = buildDeduplicatorState(entries, ctx.sessionManager.getLeafId(), ctx.cwd);
  });

  pi.on("session_tree", (event, ctx) => {
    const entries = readSessionEntries(ctx.sessionManager.getSessionFile()) ?? [];
    state = buildDeduplicatorState(entries, event.newLeafId, ctx.cwd);
  });

  pi.on("context", (event) => {
    const deduplicated = filterDeduplicatedMessages(event.messages, state);
    if (deduplicated.changed) return { messages: deduplicated.messages };
  });
}
