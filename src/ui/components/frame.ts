import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Lines } from "../lines.js";

export class Frame implements Component {
  private readonly border: DynamicBorder;

  protected children(_width: number): string[] {
    return [];
  }

  protected getHints(): [string, string][] {
    return [];
  }

  constructor(protected theme: Theme) {
    this.border = new DynamicBorder((s) => theme.fg("accent", s));
  }

  invalidate(): void {
    this.border.invalidate();
  }

  render(width: number): string[] {
    const lines = new Lines(width);
    lines.add(this.border.render(width)[0]!);
    lines.space();

    for (const child of this.children(width)) lines.add(child, 1);

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
      .join(" • ");
  }
}
