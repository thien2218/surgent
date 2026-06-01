import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { isBashMode, parseActualText, toActualText } from "../utils.js";
import type { EditorMode } from "../types.js";

function getNextMode(mode: EditorMode): EditorMode {
  switch (mode) {
    case "prompt":
      return "bash-included";
    case "bash-included":
      return "bash-excluded";
    case "bash-excluded":
      return "prompt";
  }
}

export class BashModeEditor extends CustomEditor {
  protected mode: EditorMode = "prompt";
  private persistent = false;
  private suppressWrappedChange = false;
  private externalOnSubmit: ((text: string) => void) | undefined;
  private externalOnChange: ((text: string) => void) | undefined;

  constructor(tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, editorTheme, keybindings);

    this.installWrappedCallbacks();
    const parsed = parseActualText(super.getText());
    this.mode = parsed.mode;

    if (parsed.displayText !== super.getText()) {
      this.withSuppressedChange(() => super.setText(parsed.displayText));
    }
  }

  protected getMode(): EditorMode {
    return this.mode;
  }

  protected isInBashMode(): boolean {
    return isBashMode(this.mode);
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
    const parsed = parseActualText(text);
    const actualText = isBashMode(parsed.mode) ? text : toActualText(text, this.mode);
    this.externalOnSubmit?.(actualText);
  };

  private readonly changeProxy = (text: string) => {
    if (this.suppressWrappedChange) {
      return;
    }

    this.externalOnChange?.(toActualText(text, this.mode));
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
    this.externalOnChange?.(toActualText(super.getText(), this.mode));
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
    const actualText = toActualText(super.getExpandedText(), this.mode).trim();

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

    const nextMode = getNextMode(this.mode);
    this.applyMode(nextMode, nextMode !== "prompt");
  }

  override handleInput(data: string): void {
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
    return toActualText(super.getText(), this.mode);
  }

  override getExpandedText(): string {
    return toActualText(super.getExpandedText(), this.mode);
  }

  override setText(text: string): void {
    const parsed = parseActualText(text);
    this.mode = parsed.mode;
    this.persistent = false;
    super.setText(parsed.displayText);
  }

  override insertTextAtCursor(text: string): void {
    const parsed = parseActualText(text);

    if (this.mode === "prompt" && isBashMode(parsed.mode) && /^\s*$/.test(super.getText())) {
      this.mode = parsed.mode;
      this.persistent = false;
      super.insertTextAtCursor(parsed.displayText);
      return;
    }

    super.insertTextAtCursor(text);
  }
}
