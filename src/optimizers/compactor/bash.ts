import { stripVTControlCharacters } from "node:util";
import {
  createLocalBashOperations,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";

export class BashResultCompactor {
  private readonly decoder = new TextDecoder();
  private readonly onData: (data: Buffer) => void;
  private readonly filter: RegExp | undefined;
  // Exact regex and carriage-return handling require holding one logical line.
  private currentLine = "";
  private carriageLine: string | undefined;
  private hasPendingLine = false;
  private lastLine: string | undefined;

  constructor(onData: (data: Buffer) => void, filter?: RegExp) {
    this.onData = onData;
    this.filter = filter;
  }

  append(data: Buffer) {
    this.process(this.decoder.decode(data, { stream: true }));
  }

  finish() {
    this.process(this.decoder.decode());
    if (!this.hasPendingLine) return;

    this.emit(this.getNormalizedLine(), false);
    this.resetLine();
  }

  private process(text: string) {
    for (const character of text) {
      if (character === "\r") {
        if (this.carriageLine === undefined || stripVTControlCharacters(this.currentLine).length > 0) {
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
    if (normalizedLine === this.lastLine) return;
    this.lastLine = normalizedLine;
    if (this.filter && !this.filter.test(normalizedLine)) return;

    this.onData(Buffer.from(`${normalizedLine}${terminated ? "\n" : ""}`));
  }

  private resetLine() {
    this.currentLine = "";
    this.carriageLine = undefined;
    this.hasPendingLine = false;
  }
}

const localBash = createLocalBashOperations();

export function createCompactingBashOperations(filter?: string): BashOperations {
  const lineFilter = filter === undefined ? undefined : new RegExp(filter);

  return {
    async exec(command, cwd, options) {
      const compactor = new BashResultCompactor(options.onData, lineFilter);
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
