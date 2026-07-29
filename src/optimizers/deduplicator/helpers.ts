import type { Range } from "../inspector/types.js";

export interface DeduplicatedFile {
  content: string[];
  touched: Range[];
}

export function mergeRanges(ranges: Range[]) {
  const sortedRanges = ranges.toSorted(([firstStart], [secondStart]) => firstStart - secondStart);
  const mergedRanges: Range[] = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || previousRange[1] < range[0]) {
      mergedRanges.push([range[0], range[1]]);
      continue;
    }
    previousRange[1] = Math.max(previousRange[1], range[1]);
  }

  return mergedRanges;
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

export function reconcileTouched(
  previousContent: string[],
  currentContent: string[],
  touched: Range[],
) {
  const currentLength = currentContent.length;
  const previousLength = previousContent.length;

  if (
    previousLength === currentLength &&
    previousContent.every((line, index) => line === currentContent[index])
  ) {
    return { changed: [], touched };
  }

  const unchangedLines = findUnchangedLines(previousContent, currentContent);
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

  const rawChanged: Range[] = [];
  let previousCursor = 1;
  let currentCursor = 1;

  for (const [previousStart, previousEnd, offset] of unchangedRuns) {
    const currentStart = previousStart + offset;
    if (previousStart > previousCursor || currentStart > currentCursor) {
      const changedLine = Math.min(currentCursor, currentLength);
      rawChanged.push(
        currentStart > currentCursor
          ? [currentCursor, currentStart - 1]
          : [changedLine, changedLine],
      );
    }
    previousCursor = previousEnd + 1;
    currentCursor = previousEnd + offset + 1;
  }

  if (previousCursor <= previousLength || currentCursor <= currentLength) {
    const changedLine = Math.min(currentCursor, currentLength);
    rawChanged.push(
      currentCursor <= currentLength ? [currentCursor, currentLength] : [changedLine, changedLine],
    );
  }

  const changed = mergeRanges(
    rawChanged.map(([start, end]) => [Math.max(1, start - 2), Math.min(currentLength, end + 2)]),
  );
  const shiftedTouched: Range[] = [];

  for (const [touchedStart, touchedEnd] of touched) {
    for (const [previousStart, previousEnd, offset] of unchangedRuns) {
      const intersectionStart = Math.max(touchedStart, previousStart);
      const intersectionEnd = Math.min(touchedEnd, previousEnd);

      if (intersectionStart <= intersectionEnd) {
        shiftedTouched.push([intersectionStart + offset, intersectionEnd + offset]);
      }
    }
  }

  return { changed, touched: subtractRanges(shiftedTouched, changed) };
}
