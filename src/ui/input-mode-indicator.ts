import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { isBashMode, parseActualText, toActualText } from "./utils.js";
import type { EditorMode } from "./types.js";

const INDICATOR_GUTTER_WIDTH = 2;

class ModeIndicatorEditor extends CustomEditor {
  private mode: EditorMode = "prompt";
  private suppressWrappedChange = false;
  private pendingHistoryNavigation = false;
  private requestedPaddingX = 0;
  private externalOnSubmit: ((text: string) => void) | undefined;
  private externalOnChange: ((text: string) => void) | undefined;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly uiTheme: Theme,
  ) {
    super(tui, editorTheme, keybindings);

    this.installWrappedCallbacks();
    const parsed = parseActualText(super.getText());
    this.mode = parsed.mode;

    if (parsed.displayText !== super.getText()) {
      this.withSuppressedChange(() => super.setText(parsed.displayText));
    }
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
    const actualText = toActualText(text, this.mode);
    this.mode = "prompt";
    this.externalOnSubmit?.(actualText);
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

  private getIndicator(): string {
    if (isBashMode(this.mode)) {
      return this.uiTheme.fg("warning", "!");
    }
    return this.uiTheme.fg("accent", "❯");
  }

  private applyModeBorderColor(): void {
    if (this.mode === "bash-included") {
      this.borderColor = (text) => this.uiTheme.fg("bashMode", text);
      return;
    }
    if (this.mode === "bash-excluded") {
      this.borderColor = (text) => this.uiTheme.fg("dim", text);
    }
  }

  override render(width: number): string[] {
    this.applyModeBorderColor();
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const contentLineIndex = lines.length >= 3 ? 1 : 0;
    const indicator = this.getIndicator();
    const prefix = width <= 1 ? indicator : `${indicator} `;
    const prefixWidth = visibleWidth(prefix);
    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const totalPadding = Math.min(super.getPaddingX(), maxPadding);
    const effectivePrefixWidth = Math.min(prefixWidth, totalPadding);
    const effectiveUserPadding = Math.max(
      0,
      totalPadding - effectivePrefixWidth,
    );
    const renderedPrefix = truncateToWidth(prefix, effectivePrefixWidth, "");
    const firstContentLine = lines[contentLineIndex] ?? "";

    lines[contentLineIndex] =
      " ".repeat(effectiveUserPadding) +
      renderedPrefix +
      firstContentLine.slice(totalPadding);

    return lines;
  }

  override handleInput(data: string): void {
    if (
      this.mode === "prompt" &&
      data === "!" &&
      /^\s*$/.test(super.getText())
    ) {
      this.mode = "bash-included";
      this.externalOnChange?.(toActualText(super.getText(), this.mode));
      this.tui.requestRender();
      return;
    }

    if (
      this.mode === "bash-included" &&
      data === "!" &&
      /^\s*$/.test(super.getText())
    ) {
      this.mode = "bash-excluded";
      this.externalOnChange?.(toActualText(super.getText(), this.mode));
      this.tui.requestRender();
      return;
    }

    if (
      this.mode === "bash-excluded" &&
      super.getText() === "" &&
      matchesKey(data, "backspace")
    ) {
      this.mode = "bash-included";
      this.externalOnChange?.(toActualText(super.getText(), this.mode));
      this.tui.requestRender();
      return;
    }

    if (
      this.mode === "bash-included" &&
      super.getText() === "" &&
      matchesKey(data, "backspace")
    ) {
      this.mode = "prompt";
      this.externalOnChange?.("");
      this.tui.requestRender();
      return;
    }

    this.pendingHistoryNavigation =
      matchesKey(data, "up") || matchesKey(data, "down");

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

    if (
      this.mode === "prompt" &&
      isBashMode(parsed.mode) &&
      /^\s*$/.test(super.getText())
    ) {
      this.mode = parsed.mode;
      super.insertTextAtCursor(parsed.displayText);
      return;
    }

    super.insertTextAtCursor(text);
  }

  override getPaddingX(): number {
    return this.requestedPaddingX;
  }

  override setPaddingX(padding: number): void {
    this.requestedPaddingX = Math.max(0, Math.floor(padding));
    super.setPaddingX(this.requestedPaddingX + INDICATOR_GUTTER_WIDTH);
  }
}

export default function inputModeIndicatorExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new ModeIndicatorEditor(tui, theme, keybindings, ctx.ui.theme),
    );
  });
}
