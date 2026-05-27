import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { Category, FileAccess, PromptDecision, Scope } from "./types.js";

const SCOPES: Scope[] = ["session", "project", "always"];
const SCOPE_LABELS: Record<Scope, string> = {
  session: "in this session",
  project: "in this project",
  always: "always",
};

type Mode = "select" | "amend-yes" | "amend-no" | "edit-usage";
type Cursor = 0 | 1 | 2;

function defaultValueForOp(category: Category, op?: "read" | "write"): boolean | FileAccess {
  if (category === "files") return op === "write" ? "full" : "readonly";
  return true;
}

class PermissionPromptComponent implements Component {
  private cursor: Cursor = 0;
  private scope: Scope = "session";
  private mode: Mode = "select";
  private usageText: string;
  private input = new Input();
  private cachedLines: string[] | undefined;

  onDone?: (decision: PromptDecision) => void;

  constructor(
    private readonly tui: { requestRender(): void },
    private readonly theme: { fg(role: string, text: string): string; bold(text: string): string },
    private readonly toolName: string,
    private readonly category: Category,
    private readonly key: string,
    private readonly op: "read" | "write" | undefined,
  ) {
    this.usageText = key;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.input.invalidate();
  }

  private requestRender(): void {
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.mode === "amend-yes" || this.mode === "amend-no") {
        this.mode = "select";
        this.requestRender();
        return;
      }
      this.onDone?.({ action: "deny" });
      return;
    }

    if (this.mode === "amend-yes" || this.mode === "amend-no") {
      if (matchesKey(data, Key.enter)) {
        const action = this.mode === "amend-yes" ? "allow" : "deny";
        this.onDone?.({ action });
        return;
      }
      this.input.handleInput(data);
      this.requestRender();
      return;
    }

    if (this.mode === "edit-usage") {
      if (matchesKey(data, Key.shift("tab"))) {
        const idx = SCOPES.indexOf(this.scope);
        this.scope = SCOPES[(idx + 1) % SCOPES.length]!;
        this.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const persistKey = this.input.getValue().trim() || this.key;
        this.onDone?.({
          action: "allow",
          persist: {
            scope: this.scope,
            key: persistKey,
            value: defaultValueForOp(this.category, this.op),
          },
        });
        return;
      }
      this.input.handleInput(data);
      this.usageText = this.input.getValue();
      this.requestRender();
      return;
    }

    // select mode
    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1) as Cursor;
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(2, this.cursor + 1) as Cursor;
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.cursor === 0) {
        this.onDone?.({ action: "allow" });
      } else if (this.cursor === 1) {
        this.onDone?.({ action: "deny" });
      } else {
        this.mode = "edit-usage";
        this.input.setValue(this.usageText);
        this.input.focused = true;
        this.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.tab)) {
      if (this.cursor === 0) {
        this.mode = "amend-yes";
        this.input.setValue("Yes, ");
        this.input.focused = true;
        this.requestRender();
      } else if (this.cursor === 1) {
        this.mode = "amend-no";
        this.input.setValue("No, ");
        this.input.focused = true;
        this.requestRender();
      } else {
        // cursor === 2: enter edit-usage mode
        this.mode = "edit-usage";
        this.input.setValue(this.usageText);
        this.input.focused = true;
        this.requestRender();
      }
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines) return this.cachedLines;
    const { fg, bold } = this.theme;
    const lines: string[] = [];
    const add = (line = "") => lines.push(truncateToWidth(line, width));

    // Line 1: what's being requested
    add(` ${bold("Allow")} ${fg("accent", this.key)}`);

    // Build options
    const isEditing = this.mode === "edit-usage";
    const isAmending = this.mode === "amend-yes" || this.mode === "amend-no";

    let opt0: string;
    let opt1: string;
    let opt2: string;

    if (isAmending) {
      const inputLine = this.input.render(Math.max(10, width - 10))[0] ?? "";
      const amendLabel = inputLine;
      opt0 = this.mode === "amend-yes" ? `> ${bold(amendLabel)}` : `  ${fg("muted", "1. Yes")}`;
      opt1 = this.mode === "amend-no" ? `> ${bold(amendLabel)}` : `  ${fg("muted", "2. No")}`;
      opt2 = `  ${fg("muted", `3. Yes, allow ${this.toolName} [${SCOPE_LABELS[this.scope]}]: ${this.usageText}`)}`;
    } else {
      const usageDisplay = isEditing
        ? (this.input.render(Math.max(10, width - 50))[0] ?? "")
        : fg("muted", this.usageText);
      const opt2Label = `3. Yes, allow ${this.toolName} [${SCOPE_LABELS[this.scope]}]: ${usageDisplay}`;

      opt0 = this.cursor === 0 ? `> ${bold("1. Yes")}` : `  ${fg("muted", "1. Yes")}`;
      opt1 = this.cursor === 1 ? `> ${bold("2. No")}` : `  ${fg("muted", "2. No")}`;
      opt2 = this.cursor === 2 ? `> ${bold(opt2Label)}` : `  ${fg("muted", opt2Label)}`;
    }

    add(opt0);
    add(opt1);
    add(opt2);

    // Line 3: help
    const helpParts: string[] = [];
    if (isAmending || isEditing) {
      helpParts.push("Enter confirm", "Esc back");
      if (isEditing) helpParts.push("Shift+Tab cycle scope");
    } else {
      helpParts.push("↑↓ move", "Enter select");
      if (this.cursor < 2) helpParts.push("Tab amend");
      if (this.cursor === 2) helpParts.push("Tab to edit usage", "Shift+Tab cycle scope");
    }
    add(fg("dim", ` ${helpParts.join(" • ")}`));

    this.cachedLines = lines;
    return lines;
  }
}

export async function showPermissionPrompt(
  ctx: ExtensionContext,
  toolName: string,
  category: Category,
  key: string,
  op?: "read" | "write",
): Promise<PromptDecision> {
  return ctx.ui.custom<PromptDecision>((tui, theme, _keybindings, done) => {
    const component = new PermissionPromptComponent(tui, theme, toolName, category, key, op);
    component.onDone = done;
    return component;
  });
}
