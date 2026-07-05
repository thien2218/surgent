export interface InspectToolDetails {
  path: string;
  symbol: string;
  depth: number | "full";
  lines: [number, number];
}
