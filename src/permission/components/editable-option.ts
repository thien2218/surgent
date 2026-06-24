import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { PlaceholderInput } from "../../ui/components/placeholder-input.js";
import type { Category, DisplayRule, FileAccess } from "../types.js";
import { SCOPES } from "../constants.js";
import { getScopeLabel } from "./prompt.js";

const FILE_OPS_ORDER = ["read", "write", "blocked"] as const;

function getValueLabel(value: FileAccess | boolean): string {
  if (typeof value === "boolean") {
    return value ? "allowed" : "disallowed";
  }
  if (value !== "blocked") {
    return value === "read" ? "read only" : "full access";
  }
  return value;
}

function getOptionPlaceholder(category: Category): string {
  if (category === "file") {
    return "Path or glob pattern (example: src/**/*.ts)";
  }
  if (category === "web") {
    return "Host or URL pattern (example: api.example.com/**)";
  }
  return "Command pattern (example: git * or pnpm test)";
}

export default class EditableOption implements Focusable {
  private readonly input: PlaceholderInput;
  private _focused = false;
  private _editing = false;
  private _deleted = false;
  private _modified = false;
  private _highlighted = false;

  onChange?: (updated: DisplayRule) => void;
  onCancel?: () => void;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    private readonly theme: Theme,
    private readonly rule: DisplayRule,
    private readonly alwaysEdit = false,
  ) {
    const placeholder = getOptionPlaceholder(rule.category);
    this.input = new PlaceholderInput(tui, keybindings, theme, placeholder);
    this._editing = alwaysEdit;
  }

  get deleted(): boolean {
    return this._deleted;
  }
  set deleted(value: boolean) {
    this._deleted = value;
  }

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this._editing;
    if (!this.input.focused) this.input.setText("");
  }

  set highlighted(value: boolean) {
    this._highlighted = value && !this._editing;
  }

  getRule() {
    return this.rule;
  }

  startEditing() {
    this._editing = true;
    this._modified = false;
    this.focused = true;
    this.input.setText(this.rule.expr);
    this.input.focused = this._focused;
  }

  invalidate() {
    this.input.invalidate();
  }

  render(width: number): string[] {
    if (this._deleted) return [];

    const labelWidth = 36;
    const label = `[${getScopeLabel(this.rule.scope)}] ${getValueLabel(this.rule.value)}`;
    const padding = " ".repeat(labelWidth - label.length);
    const prefix = this.theme.fg("dim", label + padding);
    const availableWidth = Math.max(1, width - labelWidth);

    if (this._editing) {
      const inputLine = this.input.render(availableWidth)[0] ?? "";
      return [truncateToWidth(prefix + inputLine, width)];
    }

    const color = this._highlighted ? "accent" : "text";
    return [truncateToWidth(prefix + this.theme.fg(color, this.rule.expr), width)];
  }

  handleInput(data: string) {
    if (!this._editing) return;

    if (matchesKey(data, Key.shift("tab"))) {
      const scopeIndex = SCOPES.indexOf(this.rule.scope);
      this.rule.scope = SCOPES[(scopeIndex + 1) % SCOPES.length]!;
      this._modified = true;
      return;
    }

    if (matchesKey(data, Key.tab)) {
      if (typeof this.rule.value === "boolean") {
        this.rule.value = !this.rule.value;
        this._modified = true;
        return;
      }

      const valueIndex = FILE_OPS_ORDER.findIndex((value) => value === this.rule.value);
      this.rule.value = FILE_OPS_ORDER[(valueIndex + 1) % FILE_OPS_ORDER.length]!;
      this._modified = true;
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const inputExpr = this.input.getText().trim();
      const nextExpr = inputExpr || this.rule.expr.trim();
      if (!nextExpr) return;

      if (nextExpr !== this.rule.expr) {
        this.rule.expr = nextExpr;
        this._modified = true;
      }

      if (this._modified || this.alwaysEdit) {
        this.onChange?.(this.rule);
      }
      this.stopEditing();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      this.stopEditing();
      return;
    }

    this.input.handleInput(data);
  }

  private stopEditing() {
    this._editing = false;
    this.focused = false;
  }
}
