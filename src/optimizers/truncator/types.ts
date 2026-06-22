export interface SummaryStore {
  active: Map<string, string>;
  pending: Map<string, string>;
}

export interface PersistedState {
  summaries: Record<string, string>;
}
