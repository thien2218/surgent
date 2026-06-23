import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  parseKey,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Lines } from "../ui/components/lines.js";
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
import { type Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../ui/components/frame.js";

export default class Questionnaire extends Frame implements Focusable {
  onDone?: (result: QuestionnaireResult) => void;

  private readonly drafts: QuestionDraft[];
  private readonly editors: Editor[];
  private currentQuestionIndex = 0;
  private statusMessage: string | undefined;
  private _focused = false;

  constructor(
    private readonly tui: TUI,
    protected theme: Theme,
    private readonly questions: NormalizedQuestion[],
  ) {
    super(theme);
    this.drafts = questions.map((question) => createInitialDraft(question));
    this.editors = questions.map(() => this.createEditor());

    for (const [index, editor] of this.editors.entries()) {
      editor.onChange = () => {
        const draft = this.drafts[index]!;
        draft.text = editor.getText();
        this.statusMessage = undefined;
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

  invalidate() {
    for (const editor of this.editors) {
      editor.invalidate();
    }
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.onDone?.({ cancelled: true, questions: [], answers: [] });
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
      if (this.handleOptionsInput(data)) return;
      if (this.shouldRouteToEditor(data)) {
        this.setFocusMode("editor");
        this.currentEditor().handleInput(data);
        const currentDraft = this.drafts[this.currentQuestionIndex]!;
        currentDraft.text = this.currentEditor().getText();
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
  }

  protected override children(width: number) {
    const lines = new Lines(width);
    const question = this.currentQuestion();
    const draft = this.currentDraft();
    const editor = this.currentEditor();

    if (this.questions.length > 1) {
      lines.add(this.renderTabs());
      lines.space();
    }

    lines.add(this.theme.bold(question.prompt));
    if (question.reason) {
      lines.add(this.theme.fg("muted", question.reason));
    }

    if (question.options.length > 0) {
      lines.space();
      lines.add(
        this.theme.fg(
          draft.focusMode === "options" ? "accent" : "muted",
          `Options ${draft.focusMode === "options" ? "[selecting]" : "[press Tab or Up/Down]"}`,
        ),
      );
      lines.space();

      for (const [index, option] of question.options.entries()) {
        const selected = draft.selectedOptionIndexes.includes(index);
        const cursor = draft.cursorIndex === index && draft.focusMode === "options";
        const marker = question.multi ? (selected ? "[x]" : "[ ]") : selected ? "(*)" : "( )";
        const prefix = cursor ? this.theme.fg("accent", "→") : " ";
        const recommendation =
          question.recommendedCount !== undefined && index < question.recommendedCount
            ? this.theme.fg("success", " [recommended]")
            : "";
        const exclusive = option.exclusive ? this.theme.fg("dim", " [exclusive]") : "";
        const optionText = `${marker} ${option.text}${recommendation}${exclusive}`;

        lines.add(`${prefix} ${cursor ? this.theme.fg("accent", optionText) : optionText}`);
        if (option.description) {
          lines.add(this.theme.fg("muted", option.description), 6);
        }
      }
    }

    lines.space();
    lines.add(
      this.theme.fg(
        draft.focusMode === "editor" ? "accent" : "muted",
        `${question.placeholder} ${draft.focusMode === "editor" ? "[editing]" : "[press Tab to edit]"}`,
      ),
    );

    for (const line of editor.render(Math.max(12, width - 2))) {
      lines.add(line);
    }

    const currentAnswer = serializeQuestionAnswer(question, draft);
    lines.space();
    if (currentAnswer) {
      lines.add(`${this.theme.fg("success", "Answer:")} ${summarizeAnswer(currentAnswer)}`);
    } else {
      lines.add(this.theme.fg("warning", this.statusMessage ?? this.currentHelpMessage()));
    }

    return lines.get();
  }

  override getHints(): [string, string][] {
    const question = this.currentQuestion();
    const base: [string, string][] = [
      ["Ctrl+Left/Right", "switch questions"],
      ["Enter", "continue"],
      ["Esc", "cancel"],
    ];

    if (question.options.length > 0) {
      base.push(["Tab", "switches focus"]);
      base.push(["Up/Down", "move options"]);
      if (question.multi) {
        base.push(["Space", "toggles options"]);
      }
    }

    return base;
  }

  private createEditor(): Editor {
    const editorTheme: EditorTheme = {
      borderColor: (text) => this.theme.fg("dim", text),
      selectList: {
        selectedPrefix: (text) => this.theme.fg("accent", text),
        selectedText: (text) => this.theme.fg("accent", text),
        description: (text) => this.theme.fg("muted", text),
        scrollInfo: (text) => this.theme.fg("dim", text),
        noMatch: (text) => this.theme.fg("warning", text),
      },
    };

    return new Editor(this.tui, editorTheme);
  }

  private currentQuestion(): NormalizedQuestion {
    return this.questions[this.currentQuestionIndex]!;
  }

  private currentDraft(): QuestionDraft {
    return this.drafts[this.currentQuestionIndex]!;
  }

  private currentEditor(): Editor {
    return this.editors[this.currentQuestionIndex]!;
  }

  private moveQuestion(delta: number) {
    const lastIndex = this.questions.length - 1;
    this.currentQuestionIndex = Math.max(0, Math.min(lastIndex, this.currentQuestionIndex + delta));
    this.statusMessage = undefined;
    this.syncEditorFocus();
  }

  private setFocusMode(focusMode: FocusMode) {
    this.currentDraft().focusMode = focusMode;
    this.statusMessage = undefined;
    this.syncEditorFocus();
  }

  private handleOptionsInput(data: string): boolean {
    const question = this.currentQuestion();
    const draft = this.currentDraft();

    if (matchesKey(data, Key.up)) {
      this.drafts[this.currentQuestionIndex] = moveCursor(question, draft, -1);
      return true;
    }

    if (matchesKey(data, Key.down)) {
      const moved = moveCursor(question, draft, 1);
      if (moved.cursorIndex === draft.cursorIndex) {
        this.setFocusMode("editor");
        return true;
      }
      this.drafts[this.currentQuestionIndex] = moved;
      return true;
    }

    if (matchesKey(data, Key.space) && question.multi) {
      const result = toggleSuggestion(question, draft, draft.cursorIndex);
      this.drafts[this.currentQuestionIndex] = {
        ...draft,
        selectedOptionIndexes: result.selectedOptionIndexes,
      };
      this.statusMessage = result.message;
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

  private submitCurrentQuestion() {
    const question = this.currentQuestion();
    const withFallbackSelection = ensureSingleSelection(question, this.currentDraft());
    this.drafts[this.currentQuestionIndex] = withFallbackSelection;
    const message = getQuestionValidationMessage(question, withFallbackSelection);

    if (message) {
      this.statusMessage = message;
      return;
    }

    this.statusMessage = undefined;

    if (this.currentQuestionIndex === this.questions.length - 1) {
      if (this.allQuestionsAnswered()) {
        this.onDone?.({
          cancelled: false,
          questions: this.questions.map((entry) => entry.prompt),
          answers: this.questions.map((entry, index) =>
            serializeQuestionAnswer(entry, this.drafts[index]!),
          ),
        });
        return;
      }

      this.currentQuestionIndex = this.firstIncompleteQuestionIndex();
      this.syncEditorFocus();
      return;
    }

    this.currentQuestionIndex += 1;
    this.syncEditorFocus();
  }

  private allQuestionsAnswered(): boolean {
    return this.questions.every((question, index) =>
      isQuestionComplete(question, this.drafts[index]!),
    );
  }

  private firstIncompleteQuestionIndex(): number {
    const index = this.questions.findIndex(
      (question, entryIndex) => !isQuestionComplete(question, this.drafts[entryIndex]!),
    );
    return index >= 0 ? index : this.questions.length - 1;
  }

  private renderTabs(): string {
    const tabs = this.questions.map((question, index) => {
      const answered = isQuestionComplete(question, this.drafts[index]!);
      const label = ` Q${index + 1}${answered ? "*" : ""} `;

      if (index === this.currentQuestionIndex) {
        return this.theme.bg("selectedBg", this.theme.fg("text", label));
      }

      return this.theme.fg(answered ? "success" : "muted", label);
    });

    return tabs.join(" ");
  }

  private currentHelpMessage(): string {
    const question = this.currentQuestion();
    if (question.options.length === 0) {
      return "Type an answer, then press Enter.";
    }
    if (question.multi) {
      return "Select options with Space, or type an answer, then press Enter.";
    }
    return "Select an option or type an answer, then press Enter.";
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

  private syncEditorFocus() {
    for (const [index, editor] of this.editors.entries()) {
      const draft = this.drafts[index]!;
      editor.focused =
        this.focused && index === this.currentQuestionIndex && draft.focusMode === "editor";
    }
  }
}
