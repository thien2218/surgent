export interface ParsedInspectorId {
  orginal: string;
  path: string;
  name: string;
  suffix: number | null;
}

export interface InspectToolDetails {
  id: string;
  depth: number | "full";
  lines: [number, number];
}
