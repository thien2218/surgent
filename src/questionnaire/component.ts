import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  parseKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  createInitialDraft,
  ensureSingleSelection,
  getQuestionValidationMessage,
  isQuestionComplete,
  moveCursor,
  serializeQuestionAnswer,
  summarizeAnswer,
  toggleSuggestion,
} from "./helpers.js";
import type { FocusMode, NormalizedQuestion, QuestionDraft, QuestionnaireResult } from "./types.js";

interface QuestionnaireTheme {
  fg(role: string, text: string): string;
  bg(role: string, text: string): string;
  bold(text: string): string;
}

interface QuestionnaireComponentOptions {
  tui: TUI;
  theme: QuestionnaireTheme;
  questions: NormalizedQuestion[];
  onDone: (result: QuestionnaireResult) => void;
}

class QuestionnaireComponent implements Component, Focusable {
  private readonly drafts: QuestionDraft[];
  private readonly editors: Editor[];
  private currentQuestionIndex = 0;
  private cachedLines: string[] | undefined;
  private statusMessage: string | undefined;
  private _focused = false;

  constructor(private readonly options: QuestionnaireComponentOptions) {
    this.drafts = options.questions.map((question) => createInitialDraft(question));
    this.editors = options.questions.map(() => this.createEditor());

    for (const [index, editor] of this.editors.entries()) {
      editor.onChange = () => {
        const draft = this.drafts[index]!;
        draft.text = editor.getText();
        this.statusMessage = undefined;
        this.requestRender();
      };
    }

    this.syncEditorFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncEditorFocus();
  }

  invalidate(): void {
    this.cachedLines = undefined;
    for (const editor of this.editors) {
      editor.invalidate();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.options.onDone({ cancelled: true, answers: [] });
      return;
    }

    if (matchesKey(data, Key.ctrl("left"))) {
      this.moveQuestion(-1);
      return;
    }

    if (matchesKey(data, Key.ctrl("right"))) {
      this.moveQuestion(1);
      return;
    }

    const question = this.currentQuestion();
    const draft = this.currentDraft();

    if (
      question.options.length > 0 &&
      (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))
    ) {
      this.setFocusMode(draft.focusMode === "editor" ? "options" : "editor");
      return;
    }

    if (draft.focusMode === "options") {
      if (this.handleOptionsInput(data)) {
        return;
      }

      if (this.shouldRouteToEditor(data)) {
        this.setFocusMode("editor");
        this.currentEditor().handleInput(data);
        const currentDraft = this.drafts[this.currentQuestionIndex]!;
        currentDraft.text = this.currentEditor().getText();
        this.requestRender();
      }
      return;
    }

    if (question.options.length > 0 && (matchesKey(data, Key.up) || matchesKey(data, Key.down))) {
      this.setFocusMode("options");
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.submitCurrentQuestion();
      return;
    }

    this.currentEditor().handleInput(data);
    const currentDraft = this.drafts[this.currentQuestionIndex]!;
    currentDraft.text = this.currentEditor().getText();
    this.requestRender();
  }

  render(width: number): string[] {
    if (this.cachedLines) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const question = this.currentQuestion();
    const draft = this.currentDraft();
    const editor = this.currentEditor();
    const add = (line = "") => lines.push(truncateToWidth(line, width));

    add(this.options.theme.fg("accent", "-".repeat(width)));

    if (this.options.questions.length > 1) {
      add(this.renderTabs(width));
      add();
    }

    add(` ${this.options.theme.bold(question.prompt)}`);
    if (question.reason) {
      add(` ${this.options.theme.fg("muted", question.reason)}`);
    }

    if (question.options.length > 0) {
      add();
      add(
        this.options.theme.fg(
          draft.focusMode === "options" ? "accent" : "muted",
          ` Suggestions ${draft.focusMode === "options" ? "[selecting]" : "[press Tab or Up/Down]"}`,
        ),
      );

      for (const [index, option] of question.options.entries()) {
        const selected = draft.selectedOptionIndexes.includes(index);
        const cursor = draft.cursorIndex === index && draft.focusMode === "options";
        const marker = question.multi ? (selected ? "[x]" : "[ ]") : selected ? "(*)" : "( )";
        const prefix = cursor ? this.options.theme.fg("accent", "> ") : "  ";
        const recommendation =
          question.recommendedCount !== undefined && index < question.recommendedCount
            ? this.options.theme.fg("success", " [recommended]")
            : "";
        const exclusive = option.exclusive ? this.options.theme.fg("dim", " [exclusive]") : "";
        const optionText = `${marker} ${option.text}${recommendation}${exclusive}`;

        add(`${prefix}${cursor ? this.options.theme.fg("accent", optionText) : optionText}`);
        if (option.description) {
          add(`     ${this.options.theme.fg("muted", option.description)}`);
        }
      }
    }

    add();
    add(
      this.options.theme.fg(
        draft.focusMode === "editor" ? "accent" : "muted",
        ` Answer ${draft.focusMode === "editor" ? "[editing]" : "[press Tab to edit]"}`,
      ),
    );

    if (!draft.text.trim()) {
      add(` ${this.options.theme.fg("dim", question.placeholder)}`);
    }

    for (const line of editor.render(Math.max(12, width - 2))) {
      add(` ${line}`);
    }

    const currentAnswer = serializeQuestionAnswer(question, draft);
    add();
    if (currentAnswer) {
      add(
        ` ${this.options.theme.fg("success", "Current answer:")} ${summarizeAnswer(currentAnswer)}`,
      );
    } else {
      add(` ${this.options.theme.fg("warning", this.statusMessage ?? this.currentHelpMessage())}`);
    }

    add();
    add(` ${this.options.theme.fg("dim", this.helpText())}`);
    add(this.options.theme.fg("accent", "-".repeat(width)));

    this.cachedLines = lines;
    return lines;
  }

  private createEditor(): Editor {
    const editorTheme: EditorTheme = {
      borderColor: (text) => this.options.theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => this.options.theme.fg("accent", text),
        selectedText: (text) => this.options.theme.fg("accent", text),
        description: (text) => this.options.theme.fg("muted", text),
        scrollInfo: (text) => this.options.theme.fg("dim", text),
        noMatch: (text) => this.options.theme.fg("warning", text),
      },
    };

    return new Editor(this.options.tui, editorTheme);
  }

  private currentQuestion(): NormalizedQuestion {
    return this.options.questions[this.currentQuestionIndex]!;
  }

  private currentDraft(): QuestionDraft {
    return this.drafts[this.currentQuestionIndex]!;
  }

  private currentEditor(): Editor {
    return this.editors[this.currentQuestionIndex]!;
  }

  private moveQuestion(delta: number): void {
    const lastIndex = this.options.questions.length - 1;
    this.currentQuestionIndex = Math.max(0, Math.min(lastIndex, this.currentQuestionIndex + delta));
    this.statusMessage = undefined;
    this.syncEditorFocus();
    this.requestRender();
  }

  private setFocusMode(focusMode: FocusMode): void {
    this.currentDraft().focusMode = focusMode;
    this.statusMessage = undefined;
    this.syncEditorFocus();
    this.requestRender();
  }

  private handleOptionsInput(data: string): boolean {
    const question = this.currentQuestion();
    const draft = this.currentDraft();

    if (matchesKey(data, Key.up)) {
      const moved = moveCursor(question, draft, -1);
      if (moved.cursorIndex === draft.cursorIndex) {
        this.setFocusMode("editor");
        return true;
      }
      this.drafts[this.currentQuestionIndex] = moved;
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.down)) {
      this.drafts[this.currentQuestionIndex] = moveCursor(question, draft, 1);
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.space) && question.multi) {
      const result = toggleSuggestion(question, draft, draft.cursorIndex);
      this.drafts[this.currentQuestionIndex] = {
        ...draft,
        selectedOptionIndexes: result.selectedOptionIndexes,
      };
      this.statusMessage = result.message;
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.enter)) {
      if (!question.multi) {
        this.drafts[this.currentQuestionIndex] = {
          ...draft,
          selectedOptionIndexes: [draft.cursorIndex],
        };
      }
      this.submitCurrentQuestion();
      return true;
    }

    return false;
  }

  private submitCurrentQuestion(): void {
    const question = this.currentQuestion();
    const withFallbackSelection = ensureSingleSelection(question, this.currentDraft());
    this.drafts[this.currentQuestionIndex] = withFallbackSelection;
    const message = getQuestionValidationMessage(question, withFallbackSelection);

    if (message) {
      this.statusMessage = message;
      this.requestRender();
      return;
    }

    this.statusMessage = undefined;

    if (this.currentQuestionIndex === this.options.questions.length - 1) {
      if (this.allQuestionsAnswered()) {
        this.options.onDone({
          cancelled: false,
          answers: this.options.questions.map((entry, index) =>
            serializeQuestionAnswer(entry, this.drafts[index]!),
          ),
        });
        return;
      }

      this.currentQuestionIndex = this.firstIncompleteQuestionIndex();
      this.syncEditorFocus();
      this.requestRender();
      return;
    }

    this.currentQuestionIndex += 1;
    this.syncEditorFocus();
    this.requestRender();
  }

  private allQuestionsAnswered(): boolean {
    return this.options.questions.every((question, index) =>
      isQuestionComplete(question, this.drafts[index]!),
    );
  }

  private firstIncompleteQuestionIndex(): number {
    const index = this.options.questions.findIndex(
      (question, entryIndex) => !isQuestionComplete(question, this.drafts[entryIndex]!),
    );
    return index >= 0 ? index : this.options.questions.length - 1;
  }

  private renderTabs(width: number): string {
    const tabs = this.options.questions.map((question, index) => {
      const answered = isQuestionComplete(question, this.drafts[index]!);
      const label = ` Q${index + 1}${answered ? "*" : ""} `;

      if (index === this.currentQuestionIndex) {
        return this.options.theme.bg("selectedBg", this.options.theme.fg("text", label));
      }

      return this.options.theme.fg(answered ? "success" : "muted", label);
    });

    return truncateToWidth(` ${tabs.join(" ")}`, width);
  }

  private currentHelpMessage(): string {
    const question = this.currentQuestion();
    if (question.options.length === 0) {
      return "Type an answer, then press Enter.";
    }
    if (question.multi) {
      return "Select suggestions with Space, or type an answer, then press Enter.";
    }
    return "Select a suggestion or type an answer, then press Enter.";
  }

  private helpText(): string {
    const question = this.currentQuestion();
    const base = ["Ctrl+Left/Right switch questions", "Enter continue", "Esc cancel"];

    if (question.options.length > 0) {
      base.unshift("Tab switches focus");
      base.unshift("Up/Down move suggestions");
      if (question.multi) {
        base.unshift("Space toggles suggestions");
      }
    }

    return base.join(" • ");
  }

  private shouldRouteToEditor(data: string): boolean {
    const parsedKey = parseKey(data);
    return (
      (parsedKey !== undefined && parsedKey.length === 1) ||
      matchesKey(data, Key.backspace) ||
      matchesKey(data, Key.delete) ||
      matchesKey(data, Key.space)
    );
  }

  private syncEditorFocus(): void {
    for (const [index, editor] of this.editors.entries()) {
      const draft = this.drafts[index]!;
      editor.focused =
        this.focused && index === this.currentQuestionIndex && draft.focusMode === "editor";
    }
  }

  private requestRender(): void {
    this.cachedLines = undefined;
    this.options.tui.requestRender();
  }
}

export function createQuestionnaireComponent(options: QuestionnaireComponentOptions): Component {
  return new QuestionnaireComponent(options);
}
