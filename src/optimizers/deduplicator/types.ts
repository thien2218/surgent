import type { Range } from "../inspector/types.js";

export interface DeduplicatedFile {
  content: string[];
  touched: Range[];
}

export interface DeduplicatorState {
  replacementsByCallId: Map<string, string[]>;
  replacementToolCallIds: Set<string>;
  resultEntryIds: Set<string>;
}

export interface ResourceResult {
  entry: Record<string, unknown>;
  entryId: string;
  range: Range;
  resource: string;
  toolCallId: string;
}
