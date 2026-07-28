import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { Range } from "../inspector/types.js";

export interface ContextPruneResult {
  changed: boolean;
  messages: ContextEvent["messages"];
}

export interface FailedEntryRemoval {
  changed: boolean;
  entries: Record<string, unknown>[];
  failedToolCallIds: Set<string>;
  replacementParents: Map<string, string | null>;
}

export interface PruneEntriesResult {
  activeLeafId: string | null;
  changed: boolean;
  entries: Record<string, unknown>[];
  failedToolCallIds: string[];
}

export interface PrunerState {
  failedToolCallIds: Set<string>;
  replacementIdsByToolCallId: Map<string, string[]>;
  resultEntryIds: Set<string>;
}

export interface ResourceResult {
  entry: Record<string, unknown>;
  entryId: string;
  kind: "inspect" | "read";
  range?: Range;
  resource: string;
}
