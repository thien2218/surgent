import { parseInspectToolDetails } from "../inspector/helpers.js";

type CustomAgentMessage = {
  role: string;
  toolName?: string;
  details?: unknown;
  input?: unknown;
  isError?: boolean;
};

export function pruneContextToolResults(messages: Array<{ role?: string }>) {
  const seenSymbols = new Set<string>();
  const keptPaths = new Set<string>();
  let changed = false;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex] as CustomAgentMessage;

    if (message.role !== "toolResult" || message.isError) continue;
    if (message.toolName === "inspect") {
      const details = parseInspectToolDetails(message.details);
      if (!details) continue;

      const symbolKey = `${details.path}#${details.symbol}`;
      if (seenSymbols.has(symbolKey)) {
        changed = true;
        messages.splice(messageIndex, 1);
        continue;
      }

      seenSymbols.add(symbolKey);
      continue;
    }

    if (message.toolName !== "read") continue;
    if (!message.input || typeof message.input !== "object") continue;

    const path = (message.input as { path?: unknown }).path;
    if (typeof path !== "string" || path.length === 0) continue;

    if (keptPaths.has(path) || keptPaths.size >= 10) {
      changed = true;
      messages.splice(messageIndex, 1);
      continue;
    }

    keptPaths.add(path);
  }

  return changed;
}
