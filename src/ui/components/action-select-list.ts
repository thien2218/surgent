import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";
import { PlaceholderInput } from "./placeholder-input.js";
import { Keybound } from "./keybound.js";

export type ActionSelectOption = {
  value: string;
  label: string;
};

export type ActionSelectResult =
  | { type: "option"; value: string; index: number }
  | { type: "input"; value: string };

type ActionSelectListConfig = {
  title: string;
  options: ActionSelectOption[];
  placeholder: string;
};

export class ActionSelectList extends Keybound implements Component, Focusable {
  onSubmit?: (result: ActionSelectResult) => void;
  onCancel?: () => void;

  private readonly input: PlaceholderInput;
  private readonly options: ActionSelectOption[];
  private readonly title: string;
  private readonly theme: Theme;

  private cursor = 0;
  private _focused = false;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    config: ActionSelectListConfig,
  ) {
    super();

    this.title = config.title;
    this.options = config.options;
    this.theme = theme;
    this.input = new PlaceholderInput(tui, keybindings, theme, config.placeholder);

    this.registerKeybindings([
      { key: Key.escape, handler: () => this.onCancel?.() },
      {
        key: { navigation: "vertical" },
        navigate: (keyId) => this.moveCursor(keyId === "up" ? -1 : 1),
      },
      {
        key: Key.enter,
        handler: (data) => {
          if (this.isEditing()) {
            if (data === "\n") {
              this.input.handleInput(data);
              return;
            }
            this.submitInputSelection();
          } else if (data !== "\n") {
            this.commitCurrentSelection();
          }
        },
      },
    ]);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  render(width: number): string[] {
    const lines = new Lines(width);

    lines.add(this.theme.bold(this.title));

    for (const [optionIndex, option] of this.options.entries()) {
      lines.add(this.renderOptionLine(optionIndex, option.label));
    }

    const inputOptionLines = this.renderInputOptionLines(width);
    for (const inputOptionLine of inputOptionLines) {
      lines.add(inputOptionLine);
    }

    return lines.get();
  }

  invalidate() {
    this.input.invalidate();
  }

  handleInput(data: string) {
    if (this.handleKb(data)) return;
    if (this.isEditing()) {
      this.input.handleInput(data);
      return;
    }
  }

  private commitCurrentSelection() {
    const selected = this.options[this.cursor];
    if (!selected) return;
    this.onSubmit?.({ type: "option", value: selected.value, index: this.cursor });
  }

  private submitInputSelection() {
    const trimmedInput = this.input.getText().trim();
    if (trimmedInput.length === 0) return;
    this.onSubmit?.({ type: "input", value: trimmedInput });
  }

  private renderOptionLine(optionIndex: number, label: string): string {
    const selected = optionIndex === this.cursor;
    const prefix = selected ? "→" : " ";
    const content = `${prefix} ${optionIndex + 1}. ${label}`;
    return this.theme.fg(selected ? "accent" : "text", content);
  }

  private renderInputOptionLines(width: number): string[] {
    const inputOptionIndex = this.options.length;
    const selected = inputOptionIndex === this.cursor;
    const prefix = selected ? "→" : " ";
    const marker = `${prefix} ${inputOptionIndex + 1}. `;
    const markerColor = selected ? "accent" : "text";
    const markerText = this.theme.fg(markerColor, marker);

    const inputContentWidth = Math.max(1, width - marker.length);
    const inputLines = this.input.render(inputContentWidth);
    if (inputLines.length === 0) {
      return [markerText];
    }

    const renderedLines: string[] = [];
    renderedLines.push(`${markerText}${inputLines[0] ?? ""}`);

    const continuationIndent = marker.length;
    for (const continuationLine of inputLines.slice(1)) {
      renderedLines.push(`${" ".repeat(continuationIndent)}${continuationLine}`);
    }

    return renderedLines;
  }

  private moveCursor(delta: number) {
    const lastIndex = this.options.length;
    this.cursor = Math.max(0, Math.min(lastIndex, this.cursor + delta));
    this.syncInputFocus();
  }

  private syncInputFocus() {
    this.input.focused = this.isEditing();
  }

  private isEditing() {
    return this._focused && this.cursor === this.options.length;
  }
}
