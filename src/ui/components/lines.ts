import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Accumulates rendered lines for a fixed-width TUI component.
 */
export class Lines {
  private readonly lines: string[];

  constructor(
    private readonly width: number,
    lines?: string[],
  ) {
    this.lines = lines ?? [];
  }

  add(line: string, pl = 0) {
    this.lines.push(truncateToWidth(" ".repeat(pl) + line, this.width));
  }

  space() {
    this.lines.push("");
  }

  get(): string[] {
    return this.lines;
  }
}
