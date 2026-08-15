import type { Range } from "../inspector/types.js";

export interface DeduplicatorState {
  replacementsByCallId: Map<string, string[]>;
  replacementToolCallIds: Set<string>;
  resultEntryIds: Set<string>;
}

export interface ResourceResult {
  entry: Record<string, unknown>;
  entryId: string;
  kind: "inspect" | "read";
  range?: Range;
  resource: string;
  toolCallId: string;
}
