export interface ParsedInspectorId {
  orginal: string;
  path: string;
  name: string;
  suffix: number | null;
}

export interface InspectorSymbol {
  signature?: string;
  body?: string;
  location?: [number, number];
}
