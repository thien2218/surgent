import type { Range } from "../inspector/types.js";

export function mergeRanges(ranges: Range[]) {
  const sorted = ranges.toSorted(([firstStart], [secondStart]) => firstStart - secondStart);
  const merged: Range[] = [];

  for (const range of sorted) {
    const previousRange = merged.at(-1);
    if (!previousRange || previousRange[1] < range[0] - 1) {
      merged.push([range[0], range[1]]);
      continue;
    }
    previousRange[1] = Math.max(previousRange[1], range[1]);
  }

  return merged;
}

export function hasFullCoverage(range: Range, candidates: Range[]): boolean {
  const intersections: Range[] = [];
  for (const candidate of candidates) {
    const start = Math.max(range[0], candidate[0]);
    const end = Math.min(range[1], candidate[1]);
    if (start <= end) intersections.push([start, end]);
  }
  if (intersections.length === 0) return false;

  const merged = mergeRanges(intersections);
  return (
    merged.reduce((lines, [start, end]) => lines + end - start + 1, 0) === range[1] - range[0] + 1
  );
}
