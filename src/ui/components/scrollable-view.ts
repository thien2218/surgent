import { DynamicBorder, getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  isFocusable,
  matchesKey,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";
import { Frame } from "./frame.js";

export type ScrollableInputComponent = Component & Partial<Focusable>;

export type ScrollableViewOptions = {
  markdown: string;
  inputComponent?: ScrollableInputComponent;
};

export class ScrollableView extends Frame implements Focusable {
  onCancel?: () => void;

  private readonly markdownRenderer: Markdown;

  private inputComponent: ScrollableInputComponent | undefined;
  private contentScrollOffset = 0;
  private lastViewportHeight = 1;
  private lastMarkdownLineCount = 0;
  private activePane: "content" | "input" = "content";
  private _focused = false;

  constructor(
    private readonly tui: TUI,
    theme: Theme,
    options: ScrollableViewOptions,
  ) {
    super(theme);

    this.inputComponent = options.inputComponent;
    this.markdownRenderer = new Markdown(options.markdown, 0, 0, getMarkdownTheme());
    this.syncInputFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  override getHints(): [string, string][] {
    const hints: [string, string][] = [
      ["↑↓", "scroll"],
      ["PgUp/PgDn", "page"],
    ];

    if (this.inputComponent) {
      hints.push(["Tab", this.activePane === "content" ? "focus input" : "focus content"]);
    }

    hints.push(["Esc", "close"]);
    return hints;
  }

  override invalidate() {
    super.invalidate();
    this.markdownRenderer.invalidate();
    this.inputComponent?.invalidate();
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (this.inputComponent && matchesKey(data, Key.tab)) {
      this.activePane = this.activePane === "content" ? "input" : "content";
      this.syncInputFocus();
      return;
    }
    if (this.activePane === "input") {
      this.inputComponent?.handleInput?.(data);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scrollBy(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollBy(1);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollBy(-Math.max(1, this.lastViewportHeight - 1));
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollBy(Math.max(1, this.lastViewportHeight - 1));
      return;
    }
  }

  protected override children(width: number): string[] {
    const contentWidth = Math.max(6, width - 1);
    const childHeightBudget = Math.max(1, this.tui.terminal.rows - 10);

    const lines = new Lines(contentWidth);
    const border = new DynamicBorder((s) =>
      this.theme.fg(this.activePane === "input" ? "accent" : "dim", s),
    );

    const inputCandidates = this.inputComponent ? this.inputComponent.render(contentWidth) : [];
    const maxInputLineCount = inputCandidates.length > 0 ? Math.max(0, childHeightBudget - 1) : 0;
    const inputLines = inputCandidates.slice(-maxInputLineCount);
    const inputSectionRows = inputLines.length > 0 ? inputLines.length + 1 : 0;

    this.lastViewportHeight = Math.max(0, childHeightBudget - inputSectionRows);

    const markdownLines = this.markdownRenderer.render(contentWidth);
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

  private scrollBy(amount: number) {
    this.contentScrollOffset += amount;
    this.clampScrollOffset();
  }

  private clampScrollOffset(totalMarkdownLines?: number) {
    const lineCount = totalMarkdownLines ?? this.lastMarkdownLineCount;
    const maxOffset = Math.max(0, lineCount - this.lastViewportHeight);
    this.contentScrollOffset = Math.max(0, Math.min(maxOffset, this.contentScrollOffset));
  }

  private syncInputFocus() {
    if (!this.inputComponent || !isFocusable(this.inputComponent)) {
      return;
    }
    this.inputComponent.focused = this._focused && this.activePane === "input";
  }
}
