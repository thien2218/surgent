import type { Range } from "../inspector/types.js";

export interface DeduplicatorState {
  replacements: Map<string, string[]>;
  resultEntryIds: Set<string>;
}

export interface ResourceResult {
  entryId: string;
  range: Range;
  resource: string;
  toolCallId: string;
  prunable: boolean;
}
