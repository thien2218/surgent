import type { Range } from "../inspector/types.js";

export interface DeduplicatorState {
  replacementsByCallId: Map<string, string[]>;
  resultEntryIds: Set<string>;
}

export interface ResourceResult {
  entry: Record<string, unknown>;
  entryId: string;
  range: Range;
  resource: string;
  toolCallId: string;
}
