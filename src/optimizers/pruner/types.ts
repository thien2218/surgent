import type { ContextEvent } from "@earendil-works/pi-coding-agent";

export interface ContextPruneResult {
  changed: boolean;
  messages: ContextEvent["messages"];
}

export interface RemovedEntryRemoval {
  changed: boolean;
  entries: Record<string, unknown>[];
  replacementParents: Map<string, string | null>;
}

export interface PruneEntriesResult {
  activeLeafId: string | null;
  changed: boolean;
  entries: Record<string, unknown>[];
}
