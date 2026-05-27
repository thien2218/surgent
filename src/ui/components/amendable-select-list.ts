import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from "@earendil-works/pi-tui";
import { Frame } from "./frame.js";
import { Lines } from "../lines.js";

const DEFAULT_OPTIONS: string[] = ["Yes", "No"];

/**
 * Interactive list component where each option can be selected bare (Enter)
 * or amended with free-form trailing text (Tab → type → Enter).
 */
export class AmendableSelectList extends Frame implements Focusable {
  /** Called with the final text when the user confirms a selection. */
  onSelect?: (text: string) => void;
  /** Called when the user presses Escape in selecting mode. */
  onCancel?: () => void;

  private readonly options: string[];
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

  constructor(
    protected theme: Theme,
    private readonly userPrompt: string,
    options?: string[],
  ) {
    super(theme);
    this.options = options && options.length > 0 ? options : DEFAULT_OPTIONS;

    this.input.onSubmit = (value) => {
      const option = this.options[this.selectedIndex]!;
      this.onSelect?.(value ? `${option}, ${value}` : option);
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

  protected override children(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const lines = new Lines(width, [this.theme.bold(this.userPrompt), ""]);

    for (let i = 0; i < this.options.length; i++) {
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? "→ " : "  ";
      const option = this.theme.fg(isSelected ? "accent" : "text", prefix + this.options[i]!);

      if (isSelected && this.amending) {
        lines.add(this.renderAmendLine(option, width));
      } else {
        lines.add(truncateToWidth(option, width));
      }
    }

    this.cachedLines = lines.get();
    this.cachedWidth = width;
    return this.cachedLines;
  }

  protected override getHints(): [string, string][] {
    return [
      ["↑↓", "navigate"],
      ["Tab", "amend"],
      ["Enter", "confirm"],
      ["Esc", "cancel"],
    ];
  }

  private renderAmendLine(option: string, width: number): string {
    const separated = option + ",";
    const availWidth = Math.max(1, width - visibleWidth(separated));
    // Input hardcodes a → " prompt (2 chars) with no ANSI codes — render wider and strip it
    const inputLine = this.input.render(availWidth + 1)[0] ?? "";
    return separated + inputLine.slice(1);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.input.invalidate();
  }
}
