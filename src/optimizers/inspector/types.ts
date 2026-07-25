export type Range = [number, number];

export interface InspectToolDetails {
  path: string;
  symbol: string;
  depth: number | "full";
  ranges: Range[];
}
