import {
  CURSOR_MARKER,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PromptDecision, PermCheck, Scope, Category, FileAccess } from "../types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../../ui/components/frame.js";
import { SCOPES, SCOPE_LABELS } from "../constants.js";
import { Lines } from "../../ui/lines.js";

type PromptOptions = {
  label: string;
  value: PromptDecision;
  persists: boolean;
  separator?: string;
  amendDefault?: string;
};

export default class PermissionPrompt extends Frame implements Focusable {
  private cursor: number = 0;
  private amending: boolean = false;
  private inputValue: string = "";
  private inputCursor: number = 0;
  private scopeIdx = 0;
  private options: PromptOptions[] = [
    { label: "Yes", separator: ",", value: { allowed: true }, persists: false },
    { label: "No", separator: ",", value: { allowed: false }, persists: false },
  ];
  private _focused = false;

  onDone?: (decision: PromptDecision) => void;
  onStoreRule?: (
    scope: Scope,
    category: Category,
    expr: string,
    value: boolean | FileAccess,
  ) => void;

  constructor(
    private readonly tui: TUI,
    protected theme: Theme,
    private readonly check: PermCheck,
    private readonly exprExists: boolean,
  ) {
    super(theme);

    const { toolName, expr } = this.check;
    const scopeLabel = SCOPE_LABELS[SCOPES[this.scopeIdx]!];

    if (expr) {
      this.options.push({
        label: `Yes, allow ${toolName} [${scopeLabel}] for:`,
        amendDefault: expr,
        value: { allowed: true },
        persists: true,
      });

      if (!this.exprExists) {
        this.options.push({
          label: `No, disallow ${toolName} [${scopeLabel}] for:`,
          amendDefault: expr,
          value: { allowed: false },
          persists: true,
        });
      }
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  override invalidate(): void {
    super.invalidate();
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    const { category, toolName, expr, danger } = this.check;
    const truncatedExpr = expr.length > 50 ? expr.slice(0, 47) + "..." : expr;
    const dangerNote = danger ? `${danger} spotted. ` : "";

    lines.add(
      this.theme.bold(
        `${dangerNote}Allow agent to call ${category} tool ${toolName}: ${truncatedExpr}?`,
      ),
    );
    lines.space();

    for (const [i, option] of this.options.entries()) {
      const isSelected = i === this.cursor;
      const prefixStr = isSelected ? "→ " : "  ";
      const prefix = isSelected ? this.theme.fg("accent", prefixStr) : prefixStr;
      const numberLabel = `${i + 1}. `;

      if (isSelected && this.amending) {
        const sep = option.separator ? option.separator + " " : " ";
        const before = this.inputValue.slice(0, this.inputCursor);
        const atChar = this.inputValue[this.inputCursor] ?? " ";
        const after = this.inputValue.slice(this.inputCursor + atChar.length);
        const marker = this._focused ? CURSOR_MARKER : "";
        const cursorSpan = `${marker}\x1b[7m${atChar}\x1b[27m`;
        const labelPart = this.theme.fg("accent", numberLabel + option.label + sep);
        lines.add(truncateToWidth(prefix + labelPart + before + cursorSpan + after, width));
      } else {
        const suffix =
          option.amendDefault !== undefined
            ? (option.separator ? option.separator + " " : " ") + option.amendDefault
            : "";
        const text = numberLabel + option.label + suffix;
        lines.add(
          truncateToWidth(prefix + (isSelected ? this.theme.fg("accent", text) : text), width),
        );
      }
    }

    return lines.get();
  }

  protected override getHints(): [string, string][] {
    return [
      ["↑↓", "navigate"],
      ["Enter", "select"],
      ["Tab", "amend"],
      ["Shift+Tab", "cycle scope"],
      ["Esc", "dismiss"],
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onDone?.({ allowed: false });
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      this.scopeIdx = (this.scopeIdx + 1) % SCOPES.length;
      this.cursor = Math.min(this.cursor, this.options.length - 1);
      this.amending = false;
      this.requestRender();
      return;
    }

    if (this.amending) {
      if (matchesKey(data, Key.enter)) {
        this.commitSelection();
        return;
      }
      if (matchesKey(data, Key.tab)) {
        this.amending = false;
        this.requestRender();
        return;
      }
      this.handleInputEdit(data);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.options.length - 1, this.cursor + 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      const option = this.options[this.cursor];
      if (option) {
        this.amending = true;
        this.inputValue = option.amendDefault ?? "";
        this.inputCursor = this.inputValue.length;
        this.requestRender();
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.commitSelection();
    }
  }

  private commitSelection(): void {
    const option = this.options[this.cursor];
    if (!option) return;

    const wasAmending = this.amending;
    this.amending = false;

    if (option.persists) {
      const ruleExpr = (wasAmending ? this.inputValue.trim() : "") || this.check.expr;
      const { category } = this.check;
      let value: boolean | "read" | "write" | "blocked";
      if (category === "file") {
        value = option.value.allowed ? (this.check.op ?? "write") : "blocked";
      } else {
        value = option.value.allowed;
      }
      this.onStoreRule?.(SCOPES[this.scopeIdx]!, category, ruleExpr, value);
      this.onDone?.({ allowed: option.value.allowed });
      return;
    }

    const decision: PromptDecision = { ...option.value };
    const inputText = wasAmending ? this.inputValue.trim() : "";
    if (inputText) decision.amended = inputText;
    this.onDone?.(decision);
  }

  private handleInputEdit(data: string): void {
    if (matchesKey(data, Key.backspace)) {
      if (this.inputCursor > 0) {
        this.inputValue =
          this.inputValue.slice(0, this.inputCursor - 1) + this.inputValue.slice(this.inputCursor);
        this.inputCursor--;
      }
      return;
    }
    if (matchesKey(data, Key.delete)) {
      this.inputValue =
        this.inputValue.slice(0, this.inputCursor) + this.inputValue.slice(this.inputCursor + 1);
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.inputCursor = Math.max(0, this.inputCursor - 1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.inputCursor = Math.min(this.inputValue.length, this.inputCursor + 1);
      return;
    }
    if (matchesKey(data, Key.home) || matchesKey(data, Key.ctrl("a"))) {
      this.inputCursor = 0;
      return;
    }
    if (matchesKey(data, Key.end) || matchesKey(data, Key.ctrl("e"))) {
      this.inputCursor = this.inputValue.length;
      return;
    }
    if (data.length >= 1) {
      const hasControlChars = [...data].some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
      });
      if (!hasControlChars) {
        this.inputValue =
          this.inputValue.slice(0, this.inputCursor) +
          data +
          this.inputValue.slice(this.inputCursor);
        this.inputCursor += data.length;
      }
    }
  }

  private requestRender(): void {
    this.tui.requestRender();
  }
}
