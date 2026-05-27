import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import { INDICATOR_GUTTER_WIDTH } from "./input-mode-indicator.js";

const AMEND_SEPARATOR = ", ";
const DEFAULT_OPTIONS: string[] = ["Yes", "No"];

type AmendableSelectListParams = {
  options: string[];
  userPrompt: string;
};

/**
 * Interactive list component where each option can be selected bare (Enter)
 * or amended with free-form trailing text (Tab → type → Enter).
 *
 * Example: option "Yes" → Tab → "Yes, but only if tests pass"
 *
 * Falls back to ["Yes", "No"] when constructed with an empty/omitted options array.
 */
export class AmendableSelectList implements Component, Focusable {
  /** Called with the final text when the user confirms a selection. */
  onSelect?: (text: string) => void;
  /** Called when the user presses Escape in selecting mode. */
  onCancel?: () => void;

  private readonly options: string[];
  private readonly theme: Theme;
  private amending = false;
  private selectedIndex = 0;
  private readonly input = new Input();
  private cachedWidth?: number;
  private cachedLines?: string[];
  private _focused = false;

  // Propagate focus to the Input child so IME cursor positioning works in amend mode
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(theme: Theme, options?: string[]) {
    this.theme = theme;
    this.options = options && options.length > 0 ? options : DEFAULT_OPTIONS;

    this.input.onSubmit = (value) => {
      const option = this.options[this.selectedIndex]!;
      this.onSelect?.(value ? `${option}${AMEND_SEPARATOR}${value}` : option);
    };

    this.input.onEscape = () => this.exitAmendMode();
  }

  // ─── Input handling ────────────────────────────────────────────────────────

  handleInput(data: string): void {
    if (this.amending) {
      this.handleAmendingInput(data);
    } else {
      this.handleSelectingInput(data);
    }
  }

  private handleSelectingInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.invalidate();
      }
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.options.length - 1) {
        this.selectedIndex++;
        this.invalidate();
      }
    } else if (matchesKey(data, Key.tab)) {
      this.enterAmendMode();
    } else if (matchesKey(data, Key.enter)) {
      this.onSelect?.(this.options[this.selectedIndex]!);
    } else if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  private handleAmendingInput(data: string): void {
    if (matchesKey(data, Key.shift("tab"))) {
      this.exitAmendMode();
      return;
    }
    if (matchesKey(data, Key.backspace) && this.input.getValue() === "") {
      this.exitAmendMode();
      return;
    }
    this.input.handleInput(data);
    this.invalidate();
  }

  private enterAmendMode(): void {
    this.amending = true;
    this.input.setValue("");
    this.input.focused = this._focused;
    this.invalidate();
  }

  private exitAmendMode(): void {
    this.amending = false;
    this.input.focused = false;
    this.invalidate();
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];

    for (let i = 0; i < this.options.length; i++) {
      const option = this.options[i]!;
      const isSelected = i === this.selectedIndex;

      if (isSelected && this.amending) {
        lines.push(this.renderAmendLine(option, width));
      } else {
        const prefix = isSelected ? this.theme.fg("accent", "> ") : "  ";
        lines.push(truncateToWidth(prefix + option, width));
      }
    }

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  private renderAmendLine(option: string, width: number): string {
    const PREFIX = this.theme.fg("accent", "> ");
    const labelSep = option + AMEND_SEPARATOR;
    const baseWidth = 2 + visibleWidth(labelSep); // PREFIX is always 2 visible chars
    const availWidth = Math.max(1, width - baseWidth);
    // Input hardcodes a "> " prompt (2 chars) with no ANSI codes — render wider and strip it
    const inputLine = this.input.render(availWidth + INDICATOR_GUTTER_WIDTH)[0] ?? "";
    return PREFIX + labelSep + inputLine.slice(INDICATOR_GUTTER_WIDTH);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.input.invalidate();
  }
}
