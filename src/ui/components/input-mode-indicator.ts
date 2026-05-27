import {
  type ExtensionAPI,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { BashModeEditor } from "./bash-mode.js";

export const INDICATOR_GUTTER_WIDTH = 2;
const BASH_MODE_HOTKEY = Key.ctrlAlt("b");

class ModeIndicatorEditor extends BashModeEditor {
  private actualPaddingX = 0;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly uiTheme: Theme,
  ) {
    super(tui, editorTheme, keybindings);
  }

  private getIndicator(): string {
    if (this.isInBashMode()) {
      return this.uiTheme.fg("warning", "!");
    }
    return this.uiTheme.fg("accent", "❯");
  }

  private applyModeBorderColor(): void {
    if (this.getMode() === "bash-included") {
      this.borderColor = (text) => this.uiTheme.fg("bashMode", text);
      return;
    }
    if (this.getMode() === "bash-excluded") {
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
    const effectiveUserPadding = Math.max(0, totalPadding - effectivePrefixWidth);
    const renderedPrefix = truncateToWidth(prefix, effectivePrefixWidth, "");
    const firstContentLine = lines[contentLineIndex] ?? "";

    lines[contentLineIndex] =
      " ".repeat(effectiveUserPadding) + renderedPrefix + firstContentLine.slice(totalPadding);

    return lines;
  }

  override getPaddingX(): number {
    return this.actualPaddingX;
  }

  override setPaddingX(padding: number): void {
    this.actualPaddingX = Math.max(0, Math.floor(padding));
    super.setPaddingX(this.actualPaddingX + INDICATOR_GUTTER_WIDTH);
  }
}

export default function registerInputModeIndicator(pi: ExtensionAPI) {
  let activeEditor: ModeIndicatorEditor | undefined;

  pi.registerShortcut(BASH_MODE_HOTKEY, {
    description: "Cycle input mode (prompt / bash (included in context) / normal bash)",
    handler: () => activeEditor?.cycleMode(),
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeEditor = new ModeIndicatorEditor(tui, theme, keybindings, ctx.ui.theme);
      return activeEditor;
    });
  });
}
