import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export type EditorMode = "prompt" | "bash-included" | "bash-excluded";

export type ParsedText = {
  mode: EditorMode;
  displayText: string;
};

export class BashModeEditor extends CustomEditor {
  protected mode: EditorMode = "prompt";
  private persistent = false;
  private suppressWrappedChange = false;
  private externalOnSubmit: ((text: string) => void) | undefined;
  private externalOnChange: ((text: string) => void) | undefined;

  constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, editorTheme, keybindings);

    this.installWrappedCallbacks();
    const parsed = this.parseActualText(super.getText());
    this.mode = parsed.mode;

    if (parsed.displayText !== super.getText()) {
      this.withSuppressedChange(() => super.setText(parsed.displayText));
    }
  }

  protected getMode(): EditorMode {
    return this.mode;
  }

  protected isInBashMode(): boolean {
    return this.isBashMode(this.mode);
  }

  private getNextMode(): EditorMode {
    switch (this.mode) {
      case "prompt":
        return "bash-included";
      case "bash-included":
        return "bash-excluded";
      case "bash-excluded":
        return "prompt";
    }
  }

  private isBashMode(mode: EditorMode): boolean {
    return mode === "bash-included" || mode === "bash-excluded";
  }

  private parseActualText(text: string): ParsedText {
    const excludedMatch = text.match(/^(\s*)!!(.*)$/s);
    if (excludedMatch) {
      return {
        mode: "bash-excluded",
        displayText: `${excludedMatch[1] ?? ""}${excludedMatch[2] ?? ""}`,
      };
    }

    const includedMatch = text.match(/^(\s*)!(.*)$/s);
    if (includedMatch) {
      return {
        mode: "bash-included",
        displayText: `${includedMatch[1] ?? ""}${includedMatch[2] ?? ""}`,
      };
    }

    return { mode: "prompt", displayText: text };
  }

  private toActualText(text: string, mode: EditorMode): string {
    if (!this.isBashMode(mode)) {
      return text;
    }

    const match = text.match(/^(\s*)(.*)$/s);
    const bangPrefix = mode === "bash-excluded" ? "!!" : "!";
    return `${match?.[1] ?? ""}${bangPrefix}${match?.[2] ?? ""}`;
  }

  private installWrappedCallbacks(): void {
    Object.defineProperty(this, "onSubmit", {
      configurable: true,
      enumerable: true,
      get: () => (this.externalOnSubmit ? this.submitProxy : undefined),
      set: (value: ((text: string) => void) | undefined) => {
        this.externalOnSubmit = value;
      },
    });

    Object.defineProperty(this, "onChange", {
      configurable: true,
      enumerable: true,
      get: () => (this.externalOnChange ? this.changeProxy : undefined),
      set: (value: ((text: string) => void) | undefined) => {
        this.externalOnChange = value;
      },
    });
  }

  private readonly submitProxy = (text: string) => {
    const parsed = this.parseActualText(text);
    const actualText = this.isBashMode(parsed.mode) ? text : this.toActualText(text, this.mode);
    this.externalOnSubmit?.(actualText);
  };

  private readonly changeProxy = (text: string) => {
    if (this.suppressWrappedChange) {
      return;
    }

    this.externalOnChange?.(this.toActualText(text, this.mode));
  };

  private withSuppressedChange(fn: () => void): void {
    this.suppressWrappedChange = true;
    try {
      fn();
    } finally {
      this.suppressWrappedChange = false;
    }
  }

  private emitChange(): void {
    this.externalOnChange?.(this.toActualText(super.getText(), this.mode));
  }

  private isHistoryNavInput(data: string): boolean {
    const keybindings = getKeybindings();
    return (
      keybindings.matches(data, "tui.editor.cursorUp") ||
      keybindings.matches(data, "tui.editor.cursorDown")
    );
  }

  private setDisplayText(displayText: string): void {
    const editorInternals = this as unknown as { setTextInternal: (text: string) => void };
    editorInternals.setTextInternal(displayText);
  }

  private handleHistoryNavInput(data: string): void {
    const text = this.toActualText(super.getText(), this.mode);
    const rawBeforeNav = super.getText();

    this.withSuppressedChange(() => super.handleInput(data));

    const rawAfterNav = super.getText();
    if (rawAfterNav === rawBeforeNav) {
      return;
    }

    const parsedHistoryText = this.parseActualText(rawAfterNav);
    this.mode = parsedHistoryText.mode;
    this.persistent = false;

    if (parsedHistoryText.displayText !== rawAfterNav) {
      this.withSuppressedChange(() => this.setDisplayText(parsedHistoryText.displayText));
    }

    const actual = this.toActualText(super.getText(), this.mode);
    if (actual !== text) {
      this.externalOnChange?.(actual);
    }
  }

  private applyMode(mode: EditorMode, persistent = this.persistent): void {
    this.mode = mode;
    this.persistent = persistent;
    this.emitChange();
  }

  private shouldHandleSubmit(data: string): boolean {
    const keybindings = getKeybindings();

    if (
      this.disableSubmit ||
      this.isShowingAutocomplete() ||
      keybindings.matches(data, "tui.input.newLine") ||
      data === "\n"
    ) {
      return false;
    }
    if (!keybindings.matches(data, "tui.input.submit")) {
      return false;
    }

    const cursor = super.getCursor();
    const currentLine = super.getLines()[cursor.line] ?? "";
    return !(cursor.col > 0 && currentLine[cursor.col - 1] === "\\");
  }

  private submitCurrentValue(): void {
    const actualText = this.toActualText(super.getExpandedText(), this.mode).trim();
    this.withSuppressedChange(() => super.setText(""));

    if (!this.persistent) {
      this.mode = "prompt";
    }

    this.emitChange();
    this.externalOnSubmit?.(actualText);
  }

  cycleMode(): void {
    if (this.mode !== "prompt" && !this.persistent) {
      return;
    }
    const nextMode = this.getNextMode();
    this.applyMode(nextMode, nextMode !== "prompt");
  }

  override handleInput(data: string): void {
    if (this.isHistoryNavInput(data)) {
      this.handleHistoryNavInput(data);
      return;
    }

    const displayText = super.getText();

    if (!this.persistent && this.mode === "prompt" && data === "!" && /^\s*$/.test(displayText)) {
      this.applyMode("bash-included", false);
      return;
    }
    if (
      !this.persistent &&
      this.mode === "bash-included" &&
      data === "!" &&
      /^\s*$/.test(displayText)
    ) {
      this.applyMode("bash-excluded", false);
      return;
    }
    if (
      !this.persistent &&
      this.mode === "bash-excluded" &&
      displayText === "" &&
      matchesKey(data, "backspace")
    ) {
      this.applyMode("bash-included", false);
      return;
    }
    if (
      !this.persistent &&
      this.mode === "bash-included" &&
      displayText === "" &&
      matchesKey(data, "backspace")
    ) {
      this.applyMode("prompt", false);
      return;
    }
    if (this.shouldHandleSubmit(data)) {
      this.submitCurrentValue();
      return;
    }

    super.handleInput(data);
  }

  override getText(): string {
    return this.toActualText(super.getText(), this.mode);
  }

  override getExpandedText(): string {
    return this.toActualText(super.getExpandedText(), this.mode);
  }

  override setText(text: string): void {
    const parsed = this.parseActualText(text);
    this.mode = parsed.mode;
    this.persistent = false;
    super.setText(parsed.displayText);
  }

  override insertTextAtCursor(text: string): void {
    const parsed = this.parseActualText(text);

    if (this.mode === "prompt" && this.isBashMode(parsed.mode) && /^\s*$/.test(super.getText())) {
      this.mode = parsed.mode;
      this.persistent = false;
      super.insertTextAtCursor(parsed.displayText);
      return;
    }

    super.insertTextAtCursor(text);
  }
}
