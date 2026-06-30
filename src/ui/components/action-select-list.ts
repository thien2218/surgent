import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  parseKey,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";
import { PlaceholderInput } from "./placeholder-input.js";

export type ActionSelectOption = {
  value: string;
  label: string;
};

export type ActionSelectResult =
  | { type: "option"; value: string; index: number }
  | { type: "input"; value: string };

export type ActionSelectListOptions = {
  title: string;
  options: ActionSelectOption[];
  placeholder: string;
};

export class ActionSelectList implements Component, Focusable {
  onSubmit?: (result: ActionSelectResult) => void;
  onCancel?: () => void;

  private readonly input: PlaceholderInput;
  private readonly options: ActionSelectOption[];
  private readonly title: string;

  private cursor = 0;
  private _focused = false;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    private readonly theme: Theme,
    options: ActionSelectListOptions,
  ) {
    this.title = options.title;
    this.options = options.options;
    this.input = new PlaceholderInput(tui, keybindings, theme, options.placeholder);
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
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (this.isInputSelected()) {
      this.handleInputEditingMode(data);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.moveCursor(1);
      return;
    }
    if (matchesKey(data, Key.enter) && data !== "\n") {
      this.commitSelection();
      return;
    }
  }

  private handleInputEditingMode(data: string) {
    if (matchesKey(data, Key.up)) {
      this.moveCursor(-1);
      this.syncInputFocus();
      return;
    }
    if (matchesKey(data, Key.enter) && data !== "\n") {
      this.submitInputSelection();
      return;
    }
    this.input.handleInput(data);
  }

  private commitSelection() {
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

  private isInputSelected(): boolean {
    return this.cursor === this.options.length;
  }

  private syncInputFocus() {
    this.input.focused = this._focused && this.isInputSelected();
  }
}
