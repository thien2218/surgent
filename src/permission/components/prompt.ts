import { Input, Key, matchesKey, visibleWidth, type Focusable } from "@earendil-works/pi-tui";
import type { PromptDecision, PermissionCheck, Scope, Category, FileAccess } from "../types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../../ui/components/frame.js";
import { SCOPES } from "../constants.js";
import { Lines } from "../../ui/lines.js";

type PromptOptions = {
  label: string;
  value: PromptDecision;
  persists: boolean;
  separator: string;
  defaultText?: string;
};

const INIT_OPTIONS = [
  { label: "Yes", separator: ",", value: { allowed: true }, persists: false },
  { label: "No", separator: ",", value: { allowed: false }, persists: false },
];

export function getScopeLabel(scope: Scope) {
  return scope !== "always" ? `this ${scope}` : scope;
}

export default class PermissionPrompt extends Frame implements Focusable {
  private cursor: number = 0;
  private amending: boolean = false;
  private readonly input = new Input();
  private scopeIdx = 0;
  private options: PromptOptions[] = [];
  private _focused = false;
  private cachedLines: string[] | undefined;

  onDone?: (decision: PromptDecision) => void;
  onStoreRule?: (
    scope: Scope,
    category: Category,
    expr: string,
    value: boolean | FileAccess,
  ) => void;

  constructor(
    protected theme: Theme,
    private readonly expr: string,
    private readonly check: PermissionCheck,
    private readonly exprExists: boolean,
  ) {
    super(theme);
    this.setOptions();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.amending;
  }

  override invalidate(): void {
    this.cachedLines = undefined;
    super.invalidate();
    this.input.invalidate();
  }

  protected override children(width: number): string[] {
    if (this.cachedLines) return this.cachedLines;

    const lines = new Lines(width);
    const { category, toolName, raw, danger } = this.check;
    const dangerNote = danger ? `${danger} detected. ` : "";

    lines.add(
      this.theme.italic(`${dangerNote}Allow agent to call ${category} tool '${toolName}'?`),
    );
    lines.add(this.theme.bold(raw));
    lines.space();

    for (const [i, option] of this.options.entries()) {
      const isSelected = i === this.cursor;
      const label = `${isSelected ? "→" : " "} ${i + 1}. ${option.label}`;

      if (isSelected && this.amending) {
        const fullLabel = this.theme.fg("accent", `${label}${option.separator}`);
        const inputWidth = width - visibleWidth(fullLabel);
        const inputLine = this.input.render(Math.max(4, width - inputWidth))[0]!.slice(1);
        lines.add(fullLabel + inputLine);
      } else {
        const suffix = option.defaultText ? `${option.separator} ${option.defaultText}` : "";
        lines.add(this.theme.fg(isSelected ? "accent" : "text", label + suffix));
      }
    }

    this.cachedLines = lines.get();
    return this.cachedLines;
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
      this.cachedLines = undefined;
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      this.scopeIdx = (this.scopeIdx + 1) % SCOPES.length;
      this.setOptions();
      this.cachedLines = undefined;
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.setAmending(false);
      this.cachedLines = undefined;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.options.length - 1, this.cursor + 1);
      this.setAmending(false);
      this.cachedLines = undefined;
      return;
    }

    if (this.amending) {
      this.cachedLines = undefined;
      if (matchesKey(data, Key.enter)) {
        this.commitSelection();
        return;
      }
      if (matchesKey(data, Key.backspace) && this.input.getValue() === "") {
        this.setAmending(false);
        return;
      }
      this.input.handleInput(data);
      return;
    }

    if (matchesKey(data, Key.tab)) {
      const option = this.options[this.cursor];
      if (option) {
        this.input.setValue(option.defaultText ?? "");
        this.setAmending(true);
      }
      this.cachedLines = undefined;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.commitSelection();
    }
  }

  private setAmending(value: boolean): void {
    this.amending = value;
    this.input.focused = this._focused && value;
    if (!value) this.input.setValue("");
  }

  private commitSelection(): void {
    const option = this.options[this.cursor];
    if (!option) return;

    this.setAmending(false);

    if (option.persists) {
      const ruleExpr = this.input.getValue().trim() || this.expr;
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
    const inputText = this.amending ? this.input.getValue().trim() : "";
    if (inputText) decision.amended = inputText;
    this.onDone?.(decision);
  }

  private setOptions() {
    const { toolName } = this.check;
    const scopeLabel = getScopeLabel(SCOPES[this.scopeIdx]!);
    this.options = [...INIT_OPTIONS];

    if (this.expr) {
      this.options.push({
        label: `Yes, allow ${toolName} tool call [${scopeLabel}] for`,
        defaultText: this.expr,
        separator: ":",
        value: { allowed: true },
        persists: true,
      });

      if (!this.exprExists) {
        this.options.push({
          label: `No, disallow ${toolName} tool call [${scopeLabel}] for`,
          defaultText: this.expr,
          separator: ":",
          value: { allowed: false },
          persists: true,
        });
      }
    }
  }
}
