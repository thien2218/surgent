import { Input, Key, matchesKey, truncateToWidth, type Focusable } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DisplayRule, FileAccess } from "../types.js";
import { SCOPES } from "../constants.js";
import { getScopeLabel } from "./prompt.js";

const FILE_OPS_ORDER = ["read", "write", "blocked"] as const;

function formatValue(value: FileAccess | boolean): string {
  if (typeof value === "boolean") {
    return value ? "allowed" : "disallowed";
  }
  if (value !== "blocked") {
    return value === "read" ? "read only" : "full access";
  }
  return value;
}

export default class EditableOption implements Focusable {
  private readonly input = new Input();
  private _focused = false;
  private _editing = false;
  private _deleted = false;
  private _modified = false;

  onChange?: (updated: DisplayRule) => void;
  onCancel?: () => void;

  constructor(
    private readonly theme: Theme,
    private readonly rule: DisplayRule,
    private readonly alwaysEdit = false,
  ) {
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
    if (!this.input.focused) this.input.setValue("");
  }

  getRule() {
    return this.rule;
  }

  startEditing(): void {
    this._editing = true;
    this.focused = true;
    this.input.setValue(this.rule.expr);
    this.input.focused = this._focused;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    if (this._deleted) return [];
    const LABEL_WIDTH = 32;
    const label = `(${getScopeLabel(this.rule.scope)}) ${formatValue(this.rule.value)}`;
    const pad = " ".repeat(LABEL_WIDTH - label.length);
    const prefix = label + pad;
    const availWidth = width - LABEL_WIDTH;

    if (this._editing) {
      const inputLine = this.input.render(availWidth)[0]!.slice(2);
      return [truncateToWidth(this.theme.fg("dim", prefix) + inputLine, width)];
    }

    return [truncateToWidth(prefix + this.rule.expr, width)];
  }

  handleInput(data: string): void {
    if (!this._editing) return;

    if (this._editing && matchesKey(data, Key.shift("tab"))) {
      const idx = SCOPES.indexOf(this.rule.scope);
      this.rule.scope = SCOPES[(idx + 1) % SCOPES.length]!;
      this._modified = true;
      return;
    }
    if (this._editing && matchesKey(data, Key.tab)) {
      if (typeof this.rule.value === "boolean") {
        this.rule.value = !this.rule.value;
        this._modified = true;
        return;
      }
      const idx = FILE_OPS_ORDER.findIndex((value) => value === this.rule.value);
      this.rule.value = FILE_OPS_ORDER[(idx + 1) % FILE_OPS_ORDER.length]!;
      this._modified = true;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const newExpr = this.input.getValue().trim() || this.rule.expr;
      if (newExpr !== this.rule.expr) {
        this.rule.expr = newExpr;
        this._modified = true;
      }

      if (this._modified) {
        this.onChange?.(this.rule);
      }
      this.stopEditing();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (!this.alwaysEdit) {
        this.onCancel?.();
        this.stopEditing();
      }
      return;
    }
    this.input.handleInput(data);
  }

  private stopEditing() {
    this._editing = false;
    this.focused = false;
  }
}
