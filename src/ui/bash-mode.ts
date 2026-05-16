import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { isBashMode, parseActualText, toActualText } from "./utils.js";
import type { EditorMode } from "./types.js";

const BASH_MODE_HOTKEY = Key.ctrlAlt("b");

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
  private suppressWrappedChange = false;
  private pendingHistoryNavigation = false;
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
    this.externalOnSubmit?.(toActualText(text, this.mode));
  };

  private readonly changeProxy = (text: string) => {
    const actualText = this.syncModeFromBaseText(text);
    this.externalOnChange?.(actualText);
  };

  private withSuppressedChange(fn: () => void): void {
    this.suppressWrappedChange = true;
    try {
      fn();
    } finally {
      this.suppressWrappedChange = false;
    }
  }

  private applyMode(mode: EditorMode, actualText?: string): void {
    this.mode = mode;
    this.externalOnChange?.(actualText ?? toActualText(super.getText(), this.mode));
    this.tui.requestRender();
  }

  private cycleMode(): void {
    this.applyMode(getNextMode(this.mode));
  }

  private syncModeFromBaseText(text: string): string {
    if (this.suppressWrappedChange) {
      return toActualText(text, this.mode);
    }

    const parsed = parseActualText(text);

    if (isBashMode(parsed.mode)) {
      this.mode = parsed.mode;
      this.withSuppressedChange(() => super.setText(parsed.displayText));
      return toActualText(parsed.displayText, this.mode);
    }
    if (this.pendingHistoryNavigation) {
      this.mode = "prompt";
    }

    return toActualText(text, this.mode);
  }

  override handleInput(data: string): void {
    if (matchesKey(data, BASH_MODE_HOTKEY)) {
      this.cycleMode();
      return;
    }
    if (this.mode === "prompt" && data === "!" && /^\s*$/.test(super.getText())) {
      this.applyMode("bash-included");
      return;
    }
    if (this.mode === "bash-included" && data === "!" && /^\s*$/.test(super.getText())) {
      this.applyMode("bash-excluded");
      return;
    }
    if (this.mode === "bash-excluded" && super.getText() === "" && matchesKey(data, "backspace")) {
      this.applyMode("bash-included");
      return;
    }
    if (this.mode === "bash-included" && super.getText() === "" && matchesKey(data, "backspace")) {
      this.applyMode("prompt", "");
      return;
    }

    this.pendingHistoryNavigation = matchesKey(data, "up") || matchesKey(data, "down");

    try {
      super.handleInput(data);
    } finally {
      this.pendingHistoryNavigation = false;
    }
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
    super.setText(parsed.displayText);
  }

  override insertTextAtCursor(text: string): void {
    const parsed = parseActualText(text);

    if (this.mode === "prompt" && isBashMode(parsed.mode) && /^\s*$/.test(super.getText())) {
      this.mode = parsed.mode;
      super.insertTextAtCursor(parsed.displayText);
      return;
    }

    super.insertTextAtCursor(text);
  }
}
