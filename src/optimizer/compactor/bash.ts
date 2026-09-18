import { stripVTControlCharacters } from "node:util";
import { createLocalBashOperations, type BashOperations } from "@earendil-works/pi-coding-agent";

const localBash = createLocalBashOperations();
const MIN_SIMILAR_LENGTH = 10;
const SIMILARITY_THRESHOLD = 0.8;

function isSimilarLine(previousLine: string, nextLine: string) {
  if (Math.min(previousLine.length, nextLine.length) < MIN_SIMILAR_LENGTH) return false;

  const longestLength = Math.max(previousLine.length, nextLine.length);
  if (1 - Math.abs(previousLine.length - nextLine.length) / longestLength < SIMILARITY_THRESHOLD) {
    return false;
  }

  const distances = new Uint32Array(nextLine.length + 1);
  for (let nextIndex = 0; nextIndex <= nextLine.length; nextIndex++) {
    distances[nextIndex] = nextIndex;
  }

  for (let previousIndex = 1; previousIndex <= previousLine.length; previousIndex++) {
    let diagonalDistance = distances[0]!;
    distances[0] = previousIndex;

    for (let nextIndex = 1; nextIndex <= nextLine.length; nextIndex++) {
      const upperDistance = distances[nextIndex]!;
      const editCost = previousLine[previousIndex - 1] === nextLine[nextIndex - 1] ? 0 : 1;
      distances[nextIndex] = Math.min(
        upperDistance + 1,
        distances[nextIndex - 1]! + 1,
        diagonalDistance + editCost,
      );
      diagonalDistance = upperDistance;
    }
  }

  return 1 - distances[nextLine.length]! / longestLength >= SIMILARITY_THRESHOLD;
}

export class BashResultCompactor {
  private readonly decoder = new TextDecoder();
  private readonly onData: (data: Buffer) => void;
  // Exact regex and carriage-return handling require holding one logical line.
  private currentLine = "";
  private carriageLine: string | undefined;
  private hasPendingLine = false;
  private pendingLine: string | undefined;
  private pendingTerminated = false;
  private omittedLines = 0;
  private hasSimilarLines = false;

  constructor(onData: (data: Buffer) => void) {
    this.onData = onData;
  }

  append(data: Buffer) {
    this.process(this.decoder.decode(data, { stream: true }));
  }

  finish() {
    this.process(this.decoder.decode());
    if (this.hasPendingLine) {
      this.emit(this.getNormalizedLine(), false);
      this.resetLine();
    }
    this.flushPending();
  }

  private process(text: string) {
    for (const character of text) {
      if (character === "\r") {
        if (
          this.carriageLine === undefined ||
          stripVTControlCharacters(this.currentLine).length > 0
        ) {
          this.carriageLine = this.currentLine;
        }
        this.currentLine = "";
        this.hasPendingLine = true;
        continue;
      }

      if (character === "\n") {
        this.emit(this.getNormalizedLine(), true);
        this.resetLine();
        continue;
      }

      this.currentLine += character;
      this.hasPendingLine = true;
    }
  }

  private getNormalizedLine() {
    const normalizedLine = stripVTControlCharacters(this.currentLine);
    if (this.carriageLine !== undefined && normalizedLine.length === 0) {
      return stripVTControlCharacters(this.carriageLine);
    }
    return normalizedLine;
  }

  private emit(normalizedLine: string, terminated: boolean) {
    if (this.pendingLine === undefined) {
      this.pendingLine = normalizedLine;
      this.pendingTerminated = terminated;
      return;
    }

    if (normalizedLine === this.pendingLine) {
      this.omittedLines++;
      return;
    }

    if (isSimilarLine(this.pendingLine, normalizedLine)) {
      this.pendingLine = normalizedLine;
      this.pendingTerminated = terminated;
      this.omittedLines++;
      this.hasSimilarLines = true;
      return;
    }

    this.flushPending();
    this.pendingLine = normalizedLine;
    this.pendingTerminated = terminated;
  }

  private flushPending() {
    if (this.pendingLine === undefined) return;

    const suffix = this.hasSimilarLines ? ` (similar line x${this.omittedLines})` : "";
    this.onData(Buffer.from(`${this.pendingLine}${suffix}${this.pendingTerminated ? "\n" : ""}`));
    this.pendingLine = undefined;
    this.pendingTerminated = false;
    this.omittedLines = 0;
    this.hasSimilarLines = false;
  }

  private resetLine() {
    this.currentLine = "";
    this.carriageLine = undefined;
    this.hasPendingLine = false;
  }
}

export function createCompactingBashOperations(filter?: string): BashOperations {
  return {
    async exec(command, cwd, options) {
      const compactor = new BashResultCompactor(options.onData);
      try {
        return await localBash.exec(command, cwd, {
          ...options,
          onData: (data) => compactor.append(data),
        });
      } finally {
        compactor.finish();
      }
    },
  };
}
