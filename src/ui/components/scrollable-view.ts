import { DynamicBorder, getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  isFocusable,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";
import { Frame } from "./frame.js";
import type { Keybindings } from "./keybound.js";

export type ScrollableViewOptions = {
  markdown: string;
  input?: Component & Partial<Focusable>;
};

export class ScrollableView extends Frame implements Focusable {
  onCancel?: () => void;

  private readonly markdownView: Markdown;
  private input: (Component & Partial<Focusable>) | undefined;
  private contentScrollOffset = 0;
  private lastViewportHeight = 1;
  private lastMarkdownLineCount = 0;
  private editing: boolean = false;
  private _focused = false;

  constructor(
    private readonly tui: TUI,
    theme: Theme,
    options: ScrollableViewOptions,
  ) {
    super(theme);

    this.input = options.input;
    this.markdownView = new Markdown(options.markdown, 0, 0, getMarkdownTheme());

    const keybindings: Keybindings = [
      { key: Key.escape, hint: "close", handler: () => this.onCancel?.() },
      {
        key: { navigation: "vertical" },
        hint: "navigate",
        navigate: (data) => this.scrollBy(data as "up" | "down"),
      },
      {
        key: { navigation: "page" },
        hint: "page",
        navigate: (data) => this.scrollBy(data as "pageUp" | "pageDown"),
      },
    ];

    if (this.input) {
      keybindings.push({
        key: Key.tab,
        hint: "switch focus",
        handler: () => {
          this.editing = !this.editing;
          this.setArrowKeyAccess({ navigation: "page" }, !this.editing);
          this.setArrowKeyAccess({ navigation: "vertical" }, { consumable: !this.editing });
          this.syncInputFocus();
        },
      });
    }

    this.registerKeybindings(keybindings);
    this.syncInputFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  override get hints(): [string, string][] {
    return [["enter", "select"], ...super.hints];
  }

  override invalidate() {
    super.invalidate();
    this.markdownView.invalidate();
    this.input?.invalidate();
  }

  handleInput(data: string) {
    if (data === "\n" || this.handleKb(data) || !this.editing) return;
    this.input?.handleInput?.(data);
  }

  protected override children(width: number): string[] {
    const contentWidth = Math.max(6, width - 1);
    const childHeightBudget = Math.max(1, this.tui.terminal.rows - 10);

    const lines = new Lines(contentWidth);
    const border = new DynamicBorder((s) => this.theme.fg(this.editing ? "accent" : "dim", s));

    const inputCandidates = this.input ? this.input.render(contentWidth) : [];
    const maxInputLineCount = inputCandidates.length > 0 ? Math.max(0, childHeightBudget - 1) : 0;
    const inputLines = inputCandidates.slice(-maxInputLineCount);
    const inputSectionRows = inputLines.length > 0 ? inputLines.length + 1 : 0;

    this.lastViewportHeight = Math.max(0, childHeightBudget - inputSectionRows);

    const markdownLines = this.markdownView.render(contentWidth);
    this.lastMarkdownLineCount = markdownLines.length;
    this.clampScrollOffset(markdownLines.length);

    const viewportStartIndex = this.contentScrollOffset;
    const viewportEndIndex = viewportStartIndex + this.lastViewportHeight;
    const visibleMarkdownLines = markdownLines.slice(viewportStartIndex, viewportEndIndex);

    for (const markdownLine of visibleMarkdownLines) {
      lines.add(markdownLine);
    }

    lines.space();
    lines.add(border.render(contentWidth)[0]!);

    if (inputLines.length > 0) {
      lines.space();
      for (const inputLine of inputLines) {
        lines.add(inputLine);
      }
    }

    return lines.get();
  }

  private scrollBy(data: "up" | "down" | "pageUp" | "pageDown") {
    let amount: number;
    if (data === "up") amount = -1;
    else if (data === "down") amount = 1;
    else if (data === "pageUp") amount = -Math.max(1, this.lastViewportHeight - 1);
    else amount = Math.max(1, this.lastViewportHeight - 1);

    this.contentScrollOffset += amount;
    this.clampScrollOffset();
  }

  private clampScrollOffset(totalMarkdownLines?: number) {
    const lineCount = totalMarkdownLines ?? this.lastMarkdownLineCount;
    const maxOffset = Math.max(0, lineCount - this.lastViewportHeight);
    this.contentScrollOffset = Math.max(0, Math.min(maxOffset, this.contentScrollOffset));
  }

  private syncInputFocus() {
    if (!this.input || !isFocusable(this.input)) return;
    this.input.focused = this._focused && this.editing;
  }
}
