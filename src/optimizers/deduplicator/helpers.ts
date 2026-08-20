import type { Range } from "../inspector/types.js";
import type { DeduplicatedFile } from "./types.js";

export function mergeRanges(ranges: Range[]) {
  const sortedRanges = ranges.toSorted(([firstStart], [secondStart]) => firstStart - secondStart);
  const mergedRanges: Range[] = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || previousRange[1] < range[0] - 1) {
      mergedRanges.push([range[0], range[1]]);
      continue;
    }
    previousRange[1] = Math.max(previousRange[1], range[1]);
  }

  return mergedRanges;
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

export function subtractRanges(ranges: Range[], removedRanges: Range[]) {
  const remainingRanges: Range[] = [];

  for (const [rangeStart, rangeEnd] of mergeRanges(ranges)) {
    let fragments: Range[] = [[rangeStart, rangeEnd]];

    for (const [removedStart, removedEnd] of removedRanges) {
      const nextFragments: Range[] = [];

      for (const [fragmentStart, fragmentEnd] of fragments) {
        if (removedEnd < fragmentStart || removedStart > fragmentEnd) {
          nextFragments.push([fragmentStart, fragmentEnd]);
          continue;
        }
        if (fragmentStart < removedStart) {
          nextFragments.push([fragmentStart, removedStart - 1]);
        }
        if (fragmentEnd > removedEnd) {
          nextFragments.push([removedEnd + 1, fragmentEnd]);
        }
      }

      fragments = nextFragments;
      if (fragments.length === 0) break;
    }
    remainingRanges.push(...fragments);
  }

  return remainingRanges;
}

function findUnchangedLines(previousContent: string[], currentContent: string[]) {
  const maximumDistance = previousContent.length + currentContent.length;
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];

  for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(new Map(frontier));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const previousDiagonal = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      const nextDiagonal = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      let previousIndex =
        diagonal === -distance || (diagonal !== distance && previousDiagonal < nextDiagonal)
          ? Math.max(0, nextDiagonal)
          : previousDiagonal + 1;
      let currentIndex = previousIndex - diagonal;

      while (
        previousIndex < previousContent.length &&
        currentIndex < currentContent.length &&
        previousContent[previousIndex] === currentContent[currentIndex]
      ) {
        previousIndex += 1;
        currentIndex += 1;
      }
      frontier.set(diagonal, previousIndex);

      if (previousIndex < previousContent.length || currentIndex < currentContent.length) continue;

      const unchangedLines: Range[] = [];
      let backtrackPreviousIndex = previousContent.length;
      let backtrackCurrentIndex = currentContent.length;

      for (
        let backtrackDistance = trace.length - 1;
        backtrackDistance >= 0;
        backtrackDistance -= 1
      ) {
        const previousFrontier = trace[backtrackDistance]!;
        const backtrackDiagonal = backtrackPreviousIndex - backtrackCurrentIndex;

        const backtrackPreviousDiagonal =
          previousFrontier.get(backtrackDiagonal - 1) ?? Number.NEGATIVE_INFINITY;
        const backtrackNextDiagonal =
          previousFrontier.get(backtrackDiagonal + 1) ?? Number.NEGATIVE_INFINITY;

        const priorDiagonal =
          backtrackDiagonal === -backtrackDistance ||
          (backtrackDiagonal !== backtrackDistance &&
            backtrackPreviousDiagonal < backtrackNextDiagonal)
            ? backtrackDiagonal + 1
            : backtrackDiagonal - 1;

        const priorPreviousIndex = Math.max(0, previousFrontier.get(priorDiagonal) ?? 0);
        const priorCurrentIndex = priorPreviousIndex - priorDiagonal;

        while (
          backtrackPreviousIndex > priorPreviousIndex &&
          backtrackCurrentIndex > priorCurrentIndex
        ) {
          unchangedLines.push([backtrackPreviousIndex, backtrackCurrentIndex]);
          backtrackPreviousIndex -= 1;
          backtrackCurrentIndex -= 1;
        }

        if (backtrackDistance === 0) break;
        if (backtrackPreviousIndex === priorPreviousIndex) {
          backtrackCurrentIndex -= 1;
        } else {
          backtrackPreviousIndex -= 1;
        }
      }

      return unchangedLines.reverse();
    }
  }

  return [];
}

export function reconcileTouched(storedFile: DeduplicatedFile, currentContent: string[]) {
  const currentLength = currentContent.length;
  const previousLength = storedFile.content.length;
  if (
    previousLength === currentLength &&
    storedFile.content.every((line, index) => line === currentContent[index])
  ) {
    return [];
  }

  const unchangedLines = findUnchangedLines(storedFile.content, currentContent);
  const unchangedRuns: [number, number, number][] = [];

  for (const [previousLine, currentLine] of unchangedLines) {
    const previousRun = unchangedRuns.at(-1);
    const offset = currentLine - previousLine;

    if (previousRun && previousRun[1] + 1 === previousLine && previousRun[2] === offset) {
      previousRun[1] = previousLine;
    } else {
      unchangedRuns.push([previousLine, previousLine, offset]);
    }
  }

  const shiftedTouched: Range[] = [];
  const rawChanged: Range[] = [];
  let previousCursor = 1;
  let currentCursor = 1;

  for (const [previousStart, previousEnd, offset] of unchangedRuns) {
    const currentStart = previousStart + offset;
    if (previousStart > previousCursor || currentStart > currentCursor) {
      rawChanged.push(
        currentStart > currentCursor
          ? [currentCursor, currentStart - 1]
          : [currentStart, currentStart],
      );
    }
    previousCursor = previousEnd + 1;
    currentCursor = previousEnd + offset + 1;

    for (const [touchedStart, touchedEnd] of storedFile.touched) {
      const intersectionStart = Math.max(touchedStart, previousStart);
      const intersectionEnd = Math.min(touchedEnd, previousEnd);

      if (intersectionStart <= intersectionEnd) {
        shiftedTouched.push([intersectionStart + offset, intersectionEnd + offset]);
      }
    }
  }

  if (previousCursor <= previousLength || currentCursor <= currentLength) {
    rawChanged.push(
      currentCursor <= currentLength
        ? [currentCursor, currentLength]
        : [currentLength, currentLength],
    );
  }

  const changed = mergeRanges(
    rawChanged.map(([start, end]) => [Math.max(1, start - 2), Math.min(currentLength, end + 2)]),
  );

  storedFile.content = currentContent;
  storedFile.touched = subtractRanges(shiftedTouched, changed);
}
