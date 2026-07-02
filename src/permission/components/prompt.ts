import {
  Input,
  Key,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
  type Focusable,
} from "@earendil-works/pi-tui";
import type { PromptDecision, PermissionCheck, Scope, Category, FileAccess } from "../types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../../ui/components/frame.js";
import { SCOPES } from "../constants.js";
import { Lines } from "../../ui/components/lines.js";
import { getScopeLabel } from "../helpers.js";

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
  ) {
    super(theme);
    this.setOptions();
    this.registerKeybindings([
      {
        key: Key.escape,
        hint: "dismiss",
        handler: () => {
          if (this.amending) {
            this.setAmending(false);
            return;
          }
          this.onDone?.({ allowed: false });
          this.cachedLines = undefined;
        },
      },
      {
        key: Key.shift("tab"),
        hint: "cycle scope",
        handler: () => {
          this.scopeIdx = (this.scopeIdx + 1) % SCOPES.length;
          this.setOptions();
          this.cachedLines = undefined;
        },
      },
      {
        key: { navigation: "vertical" },
        hint: "navigate",
        navigate: (keyId) => {
          if (keyId === Key.up) {
            this.cursor = Math.max(0, this.cursor - 1);
          } else {
            this.cursor = Math.min(this.options.length - 1, this.cursor + 1);
          }
          this.setAmending(false);
          this.cachedLines = undefined;
        },
      },
      {
        key: Key.tab,
        hint: "amend",
        handler: () => {
          if (this.amending) return;
          const option = this.options[this.cursor];
          if (option) {
            this.input.setValue(option.defaultText ?? "");
            this.setAmending(true);
          }
          this.cachedLines = undefined;
        },
      },
      {
        key: Key.enter,
        handler: () => {
          this.commitSelection();
          this.cachedLines = undefined;
        },
      },
      {
        key: Key.backspace,
        handler: () => {
          if (this.input.getValue() !== "" || !this.amending) return;
          this.setAmending(false);
        },
      },
    ]);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.amending;
  }

  override invalidate() {
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
    this.addRawLines(lines, raw, width);
    lines.space();

    for (const [i, option] of this.options.entries()) {
      const isSelected = i === this.cursor;
      const label = `${isSelected ? "→" : " "} ${i + 1}. ${option.label}`;

      if (isSelected && this.amending) {
        const fullLabel = this.theme.fg("accent", `${label}${option.separator}`);
        const inputWidth = width - visibleWidth(fullLabel);
        const inputLine = this.input.render(Math.max(4, inputWidth))[0]!.slice(1);
        lines.add(fullLabel + inputLine);
      } else {
        const suffix = option.defaultText ? `${option.separator} ${option.defaultText}` : "";
        lines.add(this.theme.fg(isSelected ? "accent" : "text", label + suffix));
      }
    }

    this.cachedLines = lines.get();
    return this.cachedLines;
  }

  handleInput(data: string) {
    if (this.handleKb(data) || !this.amending) return;
    this.cachedLines = undefined;
    this.input.handleInput(data);
  }

  private addRawLines(lines: Lines, raw: string, width: number) {
    const normalized = raw.replace(/\r\n?/g, "\n");
    const truncated = normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized;

    for (const line of truncated.split("\n")) {
      if (!line) {
        lines.space();
        continue;
      }
      for (const wrapped of wrapTextWithAnsi(this.theme.bold(line), width)) {
        lines.add(wrapped);
      }
    }
  }

  private setAmending(value: boolean) {
    this.amending = value;
    this.input.focused = this._focused && value;
    this.setKeyAccess(Key.backspace, !value);
    if (!value) this.input.setValue("");
  }

  private commitSelection() {
    const option = this.options[this.cursor];
    if (!option) return;

    const inputText = this.amending ? this.input.getValue().trim() : "";
    this.setAmending(false);

    if (option.persists) {
      const ruleExpr = inputText || this.expr;
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
    if (inputText) decision.amended = inputText;
    this.onDone?.(decision);
  }

  private setOptions() {
    const { toolName } = this.check;
    const scopeLabel = getScopeLabel(SCOPES[this.scopeIdx]!);
    this.options = [...INIT_OPTIONS];

    if (this.expr) {
      this.options.push(
        {
          label: `Yes, allow ${toolName} tool call ${scopeLabel} for`,
          defaultText: this.expr,
          separator: ":",
          value: { allowed: true },
          persists: true,
        },
        {
          label: `No, disallow ${toolName} tool call ${scopeLabel} for`,
          defaultText: this.expr,
          separator: ":",
          value: { allowed: false },
          persists: true,
        },
      );
    }
  }
}
