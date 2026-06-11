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

  private readonly customInput: PlaceholderInput;
  private readonly options: ActionSelectOption[];
  private readonly title: string;
  private readonly theme: Theme;

  private cursor = 0;
  private editing = false;
  private _focused = false;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    options: ActionSelectListOptions,
  ) {
    this.title = options.title;
    this.options = options.options;
    this.theme = theme;
    this.customInput = new PlaceholderInput(tui, keybindings, theme, options.placeholder);
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

  invalidate(): void {
    this.customInput.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (this.editing) {
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
    if (matchesKey(data, Key.tab) && this.isInputRowSelected()) {
      this.setEditingInput(true);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.commitCurrentSelection();
      return;
    }
    if (this.isInputRowSelected() && this.shouldRouteToInput(data)) {
      this.setEditingInput(true);
      this.customInput.handleInput(data);
    }
  }

  private handleInputEditingMode(data: string): void {
    if (matchesKey(data, Key.tab)) {
      this.setEditingInput(false);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.setEditingInput(false);
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.submitInputSelection();
      return;
    }

    this.customInput.handleInput(data);
  }

  private commitCurrentSelection(): void {
    if (!this.isInputRowSelected()) {
      const selectedOption = this.options[this.cursor];
      if (!selectedOption) {
        return;
      }
      this.onSubmit?.({
        type: "option",
        value: selectedOption.value,
        index: this.cursor,
      });
      return;
    }

    const trimmedInput = this.customInput.getText().trim();
    if (trimmedInput.length === 0) {
      this.setEditingInput(true);
      return;
    }

    this.submitInputSelection();
  }

  private submitInputSelection(): void {
    const trimmedInput = this.customInput.getText().trim();
    if (trimmedInput.length === 0) {
      return;
    }
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
    const inputLines = this.customInput.render(inputContentWidth);
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

  private moveCursor(delta: number): void {
    const lastIndex = this.options.length;
    this.cursor = Math.max(0, Math.min(lastIndex, this.cursor + delta));
    this.syncInputFocus();
  }

  private isInputRowSelected(): boolean {
    return this.cursor === this.options.length;
  }

  private setEditingInput(value: boolean): void {
    this.editing = value;
    this.syncInputFocus();
  }

  private syncInputFocus(): void {
    this.customInput.focused = this._focused && this.isInputRowSelected();
  }

  private shouldRouteToInput(data: string): boolean {
    const parsedKey = parseKey(data);
    return (
      (parsedKey !== undefined && parsedKey.length === 1) ||
      matchesKey(data, Key.backspace) ||
      matchesKey(data, Key.delete) ||
      matchesKey(data, Key.space)
    );
  }
}
