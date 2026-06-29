import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  parseKey,
  wrapTextWithAnsi,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Lines } from "../ui/components/lines.js";
import {
  createInitialDraft,
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

  private tab = 0;
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

    this.registerKeybindings([
      { key: Key.enter, hint: "continue", handler: () => this.submitAnswer() },
      {
        key: Key.space,
        hint: "select",
        handler: () => {
          const draft = this.drafts[this.tab]!;
          const question = this.questions[this.tab]!;
          const { selectedIndexes, message } = toggleSuggestion(question, draft, draft.cursor);

          this.drafts[this.tab] = { ...draft, selectedIndexes };
          this.statusMessage = message;
        },
      },
      {
        key: Key.escape,
        hint: "cancel",
        handler: () => this.onDone?.({ cancelled: true, questions: [], answers: [] }),
      },
      {
        key: { navigation: "horizontal", metakey: Key.alt },
        hint: "switch questions",
        navigate: (direction) => this.moveQuestion(direction === "left" ? -1 : 1),
      },
      {
        key: Key.tab,
        hint: "switches focus",
        handler: () => {
          const draft = this.drafts[this.tab]!;
          this.setFocusMode(draft.focusMode === "editor" ? "options" : "editor");
        },
      },
      {
        key: { navigation: "vertical" },
        hint: "navigate",
        navigate: (data) => {
          this.setFocusMode("options");
          const question = this.questions[this.tab]!;
          const draft = this.drafts[this.tab]!;

          if (data === "up") {
            this.drafts[this.tab] = moveCursor(question, draft, -1);
          } else {
            const moved = moveCursor(question, draft, 1);
            if (moved.cursor === draft.cursor) {
              this.setFocusMode("editor");
              return true;
            }
            this.drafts[this.tab] = moved;
            return true;
          }
        },
      },
    ]);

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
    if (this.handleKb(data)) return;

    const draft = this.drafts[this.tab]!;
    if (draft.focusMode === "options" && this.shouldRouteToEditor(data)) {
      this.setFocusMode("editor");
    }

    this.editors[this.tab]!.handleInput(data);
    const currentDraft = this.drafts[this.tab]!;
    currentDraft.text = this.editors[this.tab]!.getText();
  }

  protected override children(width: number) {
    const lines = new Lines(width);
    const question = this.questions[this.tab]!;
    const draft = this.drafts[this.tab]!;
    const editor = this.editors[this.tab]!;

    if (this.questions.length > 1) {
      lines.add(this.renderTabs());
      lines.space();
    }

    for (const wrappedPromptLine of wrapTextWithAnsi(this.theme.bold(question.prompt), width)) {
      lines.add(wrappedPromptLine);
    }

    if (question.reason) {
      for (const wrapped of wrapTextWithAnsi(this.theme.fg("muted", question.reason), width)) {
        lines.add(wrapped);
      }
    }

    if (question.options.length > 0) {
      lines.space();
      lines.add(
        this.theme.fg(
          draft.focusMode === "options" ? "accent" : "muted",
          `Options ${draft.focusMode === "options" ? "[selecting]" : "[press Tab or ↑↓]"}`,
        ),
      );
      lines.space();

      for (const [index, option] of question.options.entries()) {
        const selected = draft.selectedIndexes.includes(index);
        const cursor = draft.cursor === index && draft.focusMode === "options";
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

  private moveQuestion(delta: number) {
    const lastIndex = this.questions.length - 1;
    this.tab = Math.max(0, Math.min(lastIndex, this.tab + delta));
    this.statusMessage = undefined;
    const question = this.questions[this.tab]!;

    this.setKeyAccess(Key.tab, question.options.length > 0);
    this.setArrowKeyAccess({ navigation: "vertical" }, question.options.length > 0);
    this.syncEditorFocus();
  }

  private setFocusMode(focusMode: FocusMode) {
    this.setKeyAccess(Key.space, focusMode === "options");
    this.drafts[this.tab]!.focusMode = focusMode;
    this.statusMessage = undefined;
    this.syncEditorFocus();
  }

  private submitAnswer() {
    const draft = this.drafts[this.tab]!;
    const question = this.questions[this.tab]!;
    const message = getQuestionValidationMessage(question, draft);

    if (message) {
      this.statusMessage = message;
      return;
    }

    this.statusMessage = undefined;

    if (this.tab === this.questions.length - 1) {
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

      this.tab = this.firstIncompleteQuestionIndex();
      this.syncEditorFocus();
      return;
    }

    this.tab += 1;
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

      if (index === this.tab) {
        return this.theme.bg("selectedBg", this.theme.fg("text", label));
      }

      return this.theme.fg(answered ? "success" : "muted", label);
    });

    return tabs.join(" ");
  }

  private currentHelpMessage(): string {
    const question = this.questions[this.tab]!;
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
      editor.focused = this.focused && index === this.tab && draft.focusMode === "editor";
    }
  }
}
