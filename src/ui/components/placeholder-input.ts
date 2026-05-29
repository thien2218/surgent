import {
  CustomEditor,
  type KeybindingsManager,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export class PlaceholderInput extends CustomEditor {
  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    private readonly uiTheme: Theme,
    private readonly placeholder: string,
    private readonly customBorderColor?: ThemeColor,
  ) {
    const editorTheme: EditorTheme = {
      borderColor: (text) => uiTheme.fg(customBorderColor ?? "dim", text),
      selectList: {
        selectedPrefix: (text) => uiTheme.fg("accent", text),
        selectedText: (text) => uiTheme.fg("accent", text),
        description: (text) => uiTheme.fg("muted", text),
        scrollInfo: (text) => uiTheme.fg("dim", text),
        noMatch: (text) => uiTheme.fg("warning", text),
      },
    };
    super(tui, editorTheme, keybindings);
  }

  override render(width: number): string[] {
    const lines = super.render(width);

    if (super.getText() === "") {
      const placeholderLines = this.placeholder.split("\n").map((line, i) => {
        if (i === 0 && this.focused) {
          const firstChar = line.charAt(0) || " ";
          const rest = line.slice(1);
          // Visible cursor requires BOTH the marker (IME positioning) AND the
          // reverse-video block — the TUI hides the hardware cursor by default.
          const cursor = CURSOR_MARKER + `\x1b[7m${firstChar}\x1b[0m`;
          const dimRest = rest.length > 0 ? this.uiTheme.fg("dim", rest) : "";
          return truncateToWidth(cursor + dimRest, width);
        }
        return truncateToWidth(this.uiTheme.fg("dim", line), width);
      });

      if (this.customBorderColor) {
        return [lines[0]!, ...placeholderLines, lines[lines.length - 1]!];
      }
      return placeholderLines;
    }

    const contentLines = lines.slice(1, lines.length - 1);
    if (this.customBorderColor) {
      return [lines[0]!, ...contentLines, lines[lines.length - 1]!];
    }
    return contentLines;
  }
}
