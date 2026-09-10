import { Input, Key, visibleWidth, wrapTextWithAnsi, type Focusable } from "@earendil-works/pi-tui";
import type { PromptDecision, PermissionCheck, PromptOptions, FileAccess } from "../types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../../ui/components/frame.js";
import { SCOPES } from "../constants.js";
import { Lines } from "../../ui/components/lines.js";
import { getScopeLabel, mapToRules } from "../helpers.js";
import { addRules } from "../storage.js";
import { toPattern } from "../pattern.js";
import { unique } from "../../utils.js";

export default class PermissionPrompt extends Frame implements Focusable {
  private cursor: number = 0;
  private amending: boolean = false;
  private readonly input = new Input();
  private scopeIdx = 0;
  private options: PromptOptions[] = [];
  private _focused = false;
  private cachedLines: string[] | undefined;
  private inputError: string | undefined;
  private readonly patterns: string[] = [];

  onDone?: (decision: PromptDecision) => void;

  constructor(
    protected theme: Theme,
    private readonly check: PermissionCheck,
    private readonly cwd: string,
  ) {
    super(theme);
    if (!check.uncertainty) {
      this.patterns = unique(
        check.extracted.map((item) => toPattern(check.toolName, item)).filter(Boolean),
      );
    }

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
    const { toolName, extracted, uncertainty } = this.check;
    const uncertaintyNote = uncertainty ? `${uncertainty} detected. ` : "";

    lines.add(this.theme.italic(`${uncertaintyNote}Allow agent to use '${toolName}' tool?`));
    for (const line of wrapTextWithAnsi(this.check.purpose, width)) {
      lines.add(this.theme.fg("muted", line));
    }

    lines.space();
    this.addRawLines(lines, extracted.join(", "), width);
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

    if (this.inputError) {
      lines.space();
      lines.add(this.theme.fg("warning", this.inputError));
    }

    this.cachedLines = lines.get();
    return this.cachedLines;
  }

  handleInput(data: string) {
    if (this.handleKb(data) || !this.amending) return;
    this.cachedLines = undefined;
    this.inputError = undefined;
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
    this.inputError = undefined;
    this.input.focused = this._focused && value;
    this.setKeyAccess(Key.backspace, !value);
    if (!value) this.input.setValue("");
  }

  private commitSelection() {
    const option = this.options[this.cursor];
    if (!option) return;

    const inputText = this.amending ? this.input.getValue().trim() : "";
    if (option.persists) {
      let patterns = this.patterns;
      if (inputText) {
        try {
          const parsed: unknown[] = JSON.parse(`[${inputText}]`);
          patterns = unique(
            parsed
              .map((pattern) => (typeof pattern === "string" ? pattern.trim() : ""))
              .filter(Boolean),
          );
          if (parsed.length === 0) throw new Error();
        } catch {
          this.inputError = "Enter non-empty patterns in double quotes, separated by commas";
          return;
        }
      }

      const rules = mapToRules(patterns, this.check.category, option.value.allowed);
      this.setAmending(false);
      void addRules(
        this.cwd,
        this.check.sessionId,
        SCOPES[this.scopeIdx]!,
        this.check.category,
        rules,
      );
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
    this.options = [
      { label: "Yes", separator: ",", value: { allowed: true }, persists: false },
      { label: "No", separator: ",", value: { allowed: false }, persists: false },
    ];
    if (this.check.uncertainty) return;

    const defaultText = this.patterns.map((pattern) => JSON.stringify(pattern)).join(", ");
    this.options.push(
      {
        label: `Yes, allow ${toolName} tool call ${scopeLabel} for`,
        defaultText,
        separator: ":",
        value: { allowed: true },
        persists: true,
      },
      {
        label: `No, disallow ${toolName} tool call ${scopeLabel} for`,
        defaultText,
        separator: ":",
        value: { allowed: false },
        persists: true,
      },
    );
  }
}
