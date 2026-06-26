import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { PlaceholderInput } from "./placeholder-input.js";

type EditableOptionMode<TValue> =
  | { type: "input"; placeholder: string; text?: string; startEditing?: boolean }
  | { type: "toggle"; values: readonly TValue[]; getValueLabel?: (value: TValue) => string };

type EditableOptionOptions<TValue> = {
  label: string;
  labelWidth?: number;
  mode: EditableOptionMode<TValue>;
};

export class EditableOption<TValue = string> implements Focusable {
  onInputSubmit?: (value: string) => boolean | void;
  onInputCancel?: () => void;
  onToggle?: (value: TValue, index: number) => void;

  private readonly theme: Theme;
  private readonly labelWidth: number;
  private readonly mode: EditableOptionMode<TValue>;
  private readonly input?: PlaceholderInput;

  private label: string;
  private inputText = "";
  private toggleIndex = 0;

  private _focused = false;
  private _highlighted = false;
  private _editing = false;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    options: EditableOptionOptions<TValue>,
  ) {
    this.theme = theme;
    this.mode = options.mode;
    this.label = options.label;
    this.labelWidth = options.labelWidth ?? 48;

    if (this.mode.type === "input") {
      this.input = new PlaceholderInput(tui, keybindings, theme, this.mode.placeholder);
      this.inputText = this.mode.text ?? "";
      this._editing = this.mode.startEditing ?? false;
      if (this._editing) {
        this.input.setText(this.inputText);
      }
      this.syncInputFocus();
      return;
    }

    if (this.mode.values.length === 0) {
      throw new Error("EditableOption toggle mode requires at least one value.");
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  get editing(): boolean {
    return this._editing;
  }

  set highlighted(value: boolean) {
    this._highlighted = value && !this._editing;
  }

  setLabel(label: string) {
    this.label = label;
  }

  setText(value: string) {
    this.inputText = value;
    if (!this._editing) return;
    this.input?.setText(value);
  }

  getText(): string {
    return this.inputText;
  }

  startEditing() {
    if (this.mode.type !== "input") return;
    this._editing = true;
    this.input?.setText(this.inputText);
    this.syncInputFocus();
  }

  invalidate() {
    this.input?.invalidate();
  }

  render(width: number): string[] {
    const [prefix, contentWidth] = this.renderPrefix(width);

    if (this.mode.type === "input") {
      if (this._editing) {
        const inputLine = this.input?.render(contentWidth)[0] ?? "";
        return [truncateToWidth(prefix + inputLine, width)];
      }
      const color = this._highlighted ? "accent" : "text";
      return [truncateToWidth(prefix + this.theme.fg(color, this.inputText), width)];
    }

    const currentValue = this.mode.values[this.toggleIndex]!;
    const valueLabel = this.mode.getValueLabel?.(currentValue) ?? String(currentValue);
    const color = this._highlighted ? "accent" : "text";
    return [truncateToWidth(prefix + this.theme.fg(color, valueLabel), width)];
  }

  handleInput(data: string) {
    if (this.mode.type === "toggle") {
      if (matchesKey(data, Key.enter)) {
        this.cycleToggle();
      }
      return;
    }

    if (!this._editing) return;

    if (matchesKey(data, Key.escape)) {
      this.stopEditing();
      this.onInputCancel?.();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const value = this.input?.getText() ?? "";
      const hasSubmitHandler = this.onInputSubmit !== undefined;
      const submitResult = this.onInputSubmit?.(value);
      if (submitResult === false) return;

      if (!hasSubmitHandler) {
        this.inputText = value;
      }
      this.stopEditing();
      return;
    }

    this.input?.handleInput(data);
  }

  getToggleValue(): TValue | undefined {
    if (this.mode.type !== "toggle") return undefined;
    return this.mode.values[this.toggleIndex];
  }

  private cycleToggle() {
    if (this.mode.type !== "toggle") return;
    this.toggleIndex = (this.toggleIndex + 1) % this.mode.values.length;
    const currentValue = this.mode.values[this.toggleIndex]!;
    this.onToggle?.(currentValue, this.toggleIndex);
  }

  private stopEditing() {
    this._editing = false;
    if (this.mode.type === "input") {
      this.input?.setText(this.inputText);
    }
    this.syncInputFocus();
  }

  private syncInputFocus() {
    if (this.mode.type !== "input") return;
    if (!this.input) return;
    this.input.focused = this._focused && this._editing;
  }

  private renderPrefix(width: number): [string, number] {
    if (this.labelWidth === undefined) {
      const label = `${this.label} `;
      return [this.theme.fg("dim", label), Math.max(1, width - label.length)];
    }

    const labelText =
      this.label.length >= this.labelWidth
        ? this.label.slice(0, this.labelWidth)
        : this.label + " ".repeat(this.labelWidth - this.label.length);

    return [this.theme.fg("dim", labelText), Math.max(1, width - this.labelWidth)];
  }
}
