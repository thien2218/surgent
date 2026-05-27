import { truncateToWidth } from "@earendil-works/pi-tui";

type Padding = {
  left?: number;
  top?: number;
  bottom?: number;
};

/**
 * Accumulates rendered lines for a fixed-width TUI component.
 * Replaces the `const add = (line = "") => lines.push(truncateToWidth(line, width))` pattern.
 */
export class Lines {
  private readonly lines: string[] = [];

  constructor(private readonly width: number) {}

  add(line = "", padding?: Padding): void {
    const { left = 0, top = 0, bottom = 0 } = padding ?? {};

    for (let i = 0; i < top; i++) {
      this.lines.push("");
    }

    const padded = line && left > 0 ? " ".repeat(left) + line : line;
    this.lines.push(truncateToWidth(padded, this.width));

    for (let i = 0; i < bottom; i++) {
      this.lines.push("");
    }
  }

  get(): string[] {
    return this.lines;
  }
}
