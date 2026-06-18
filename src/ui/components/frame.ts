import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";

export class Frame implements Component {
  private readonly border: DynamicBorder;
  private readonly custom: Component[] = [];

  protected children(_width: number): string[] {
    return [];
  }

  getHints(): [string, string][] {
    return [];
  }

  constructor(protected theme: Theme) {
    this.border = new DynamicBorder((s) => theme.fg("accent", s));
  }

  addCustom(child: Component) {
    this.custom.push(child);
  }

  invalidate() {
    this.border.invalidate();
  }

  render(width: number): string[] {
    const lines = new Lines(width);
    lines.add(this.border.render(width)[0]!);
    lines.space();

    if (!this.custom.length) {
      for (const child of this.children(width - 1)) {
        lines.add(child, 1);
      }
    } else {
      for (const item of this.custom) {
        for (const line of item.render(width - 1)) {
          lines.add(line, 1);
        }
      }
    }

    if (this.getHints().length > 0) {
      lines.space();
      lines.add(this.renderHints(), 1);
    }

    lines.space();
    lines.add(this.border.render(width)[0]!);
    return lines.get();
  }

  private renderHints(): string {
    return this.getHints()
      .map(([key, action]) => this.theme.fg("dim", key) + " " + action)
      .join(this.theme.fg("muted", " • "));
  }
}
