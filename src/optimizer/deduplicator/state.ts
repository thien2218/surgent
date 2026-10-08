import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { getInspectIdentity } from "./resources.js";

export function buildDeduplicatorState(entries: ProjectedSessionEntry[], cwd: string): Set<string> {
  const retained = new Set<string>();
  const hidden = new Set<string>();

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    const message = getEligibleResult(entry);
    if (!message || message.isError || message.toolName !== "inspect") continue;

    const identity = getInspectIdentity(message.details, cwd);
    if (!identity) continue;
    if (retained.has(identity)) hidden.add(entry.sourceEntry.id);
    retained.add(identity);
  }

  return hidden;
}
