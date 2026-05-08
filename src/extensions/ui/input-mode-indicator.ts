import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorComponent,
  type Focusable,
} from "@earendil-works/pi-tui";
import {
  parseActualText,
  toActualText,
  isFocusable,
  type EditorMode,
} from "../../utils/ui.js";

class ModeIndicatorEditor implements EditorComponent, Focusable {
  private fallbackFocused = false;
  private mode: EditorMode;
  private suppressWrappedChange = false;
  private pendingHistoryNavigation = false;
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;

  constructor(
    private readonly base: EditorComponent,
    private readonly getIndicator: (mode: EditorMode) => string,
  ) {
    const parsed = parseActualText(this.base.getText());
    this.mode = parsed.mode;
    if (parsed.displayText !== this.base.getText()) {
      this.withSuppressedChange(() => this.base.setText(parsed.displayText));
    }

    this.base.onSubmit = (text) => {
      const submitted = toActualText(text, this.mode);
      this.mode = "prompt";
      this.onSubmit?.(submitted);
    };

    this.base.onChange = (text) => {
      const actualText = this.syncModeFromBaseText(text);
      this.onChange?.(actualText);
    };
  }

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
    if (parsed.mode === "bash") {
      this.mode = "bash";
      this.withSuppressedChange(() => this.base.setText(parsed.displayText));
      return toActualText(parsed.displayText, this.mode);
    }

    if (this.pendingHistoryNavigation) {
      this.mode = "prompt";
    }

    return toActualText(text, this.mode);
  }

  get focused(): boolean {
    return isFocusable(this.base) ? this.base.focused : this.fallbackFocused;
  }

  set focused(value: boolean) {
    this.fallbackFocused = value;
    if (isFocusable(this.base)) {
      this.base.focused = value;
    }
  }

  get borderColor(): (str: string) => string {
    return this.base.borderColor as (str: string) => string;
  }

  set borderColor(value: (str: string) => string) {
    this.base.borderColor = value;
  }

  render(width: number): string[] {
    const lines = this.base.render(width);
    if (lines.length === 0) return lines;

    const contentLineIndex = lines.length >= 3 ? 1 : 0;
    const indicator = this.getIndicator(this.mode);
    const prefix = width <= 1 ? indicator : `${indicator} `;
    const prefixWidth = visibleWidth(prefix);
    lines[contentLineIndex] =
      prefix +
      truncateToWidth(
        lines[contentLineIndex] ?? "",
        Math.max(0, width - prefixWidth),
        "",
      );
    return lines;
  }

  invalidate(): void {
    this.base.invalidate();
  }

  handleInput(data: string): void {
    if (
      this.mode === "prompt" &&
      data === "!" &&
      /^\s*$/.test(this.base.getText())
    ) {
      this.mode = "bash";
      this.onChange?.(toActualText(this.base.getText(), this.mode));
      return;
    }

    if (
      this.mode === "bash" &&
      this.base.getText() === "" &&
      matchesKey(data, "backspace")
    ) {
      this.mode = "prompt";
      this.onChange?.("");
      return;
    }

    this.pendingHistoryNavigation =
      matchesKey(data, "up") || matchesKey(data, "down");
    try {
      this.base.handleInput(data);
    } finally {
      this.pendingHistoryNavigation = false;
    }
  }

  getText(): string {
    return toActualText(this.base.getText(), this.mode);
  }

  setText(text: string): void {
    const parsed = parseActualText(text);
    this.mode = parsed.mode;
    this.base.setText(parsed.displayText);
  }

  addToHistory(text: string): void {
    this.base.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    const parsed = parseActualText(text);
    if (
      this.mode === "prompt" &&
      parsed.mode === "bash" &&
      /^\s*$/.test(this.base.getText())
    ) {
      this.mode = "bash";
      this.base.insertTextAtCursor?.(parsed.displayText);
      return;
    }

    this.base.insertTextAtCursor?.(text);
  }

  getExpandedText(): string {
    return toActualText(
      this.base.getExpandedText?.() ?? this.base.getText(),
      this.mode,
    );
  }

  setAutocompleteProvider(
    provider: Parameters<
      NonNullable<EditorComponent["setAutocompleteProvider"]>
    >[0],
  ): void {
    this.base.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.base.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.base.setAutocompleteMaxVisible?.(maxVisible);
  }
}

export default function inputModeIndicatorExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const previousFactory = ctx.ui.getEditorComponent();

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const base =
        previousFactory?.(tui, theme, keybindings) ??
        new CustomEditor(tui, theme, keybindings);

      return new ModeIndicatorEditor(base, (mode) => {
        if (mode === "bash") {
          return ctx.ui.theme.fg("warning", "!");
        }
        return ctx.ui.theme.fg("accent", "❯");
      });
    });
  });
}
