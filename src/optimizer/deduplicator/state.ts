import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { getInspectIdentity } from "./resources.js";

export function buildDeduplicatorState(entries: ProjectedSessionEntry[], cwd: string): Map<string, string[]> {
  const retained = new Map<string, string>();
  const replacements = new Map<string, string[]>();

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    const message = getEligibleResult(entry);
    if (!message || message.isError || message.toolName !== "inspect") continue;

    const identity = getInspectIdentity(message.details, cwd);
    if (!identity) continue;

    const newest = retained.get(identity);
    if (newest) {
      replacements.set(entry.sourceEntry.id, [newest]);
    } else {
      retained.set(identity, entry.sourceEntry.id);
    }
  }

  return replacements;
}
