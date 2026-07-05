export interface InspectToolDetails {
  path: string;
  symbol: string;
  depth: number | "full";
  range: [number, number];
}
