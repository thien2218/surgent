import {
  Editor,
  Key,
  matchesKey,
  parseKey,
  wrapTextWithAnsi,
  type EditorTheme,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { type Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../ui/components/frame.js";
import { Lines } from "../ui/components/lines.js";
import {
  createInitialDraft,
  ensureSingleSelection,
  getValidationMessage,
  moveCursor,
  serializeQuestionAnswer,
  summarizeAnswer,
  toggleSuggestion,
} from "./helpers.js";
import type { NormalizedQuestion, QuestionDraft, QuestionnaireResult } from "./types.js";

export default class Questionnaire extends Frame implements Focusable {
  onDone?: (result: QuestionnaireResult) => void;

  private readonly drafts: QuestionDraft[];
  private readonly editors: Editor[] = [];

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
    this.questions.forEach((_, index) => {
      const editor = this.createEditor();
      editor.onChange = () => {
        const draft = this.drafts[index]!;
        draft.text = editor.getText();
        this.statusMessage = undefined;
      };
      this.editors.push(editor);
    });

    this.registerKeybindings([
      {
        key: Key.escape,
        hint: "cancel",
        handler: () => this.onDone?.({ cancelled: true, questions: [], answers: [] }),
      },
      {
        key: { navigation: "horizontal", metakey: Key.alt },
        hint: "switch questions",
        navigate: (keyId) => this.moveQuestion(keyId === Key.left ? -1 : 1),
      },
      {
        key: { navigation: "vertical" },
        hint: "focus options",
        navigate: (keyId) => this.handleVerticalNav(keyId),
      },
      { key: Key.tab, hint: "switch focus", handler: () => this.toggleFocusMode() },
      { key: Key.space, hint: "toggle option", handler: () => this.toggleOption() },
      { key: Key.enter, hint: "continue", handler: () => this.handleEnterKey() },
    ]);
    this.syncInteractionState();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncEditorFocus();
  }

  invalidate() {
    for (const editor of this.editors) editor.invalidate();
  }

  handleInput(data: string) {
    if (this.handleKb(data)) return;
    if (!this.drafts[this.tab]!.editing) {
      const parsedKey = parseKey(data);
      const shouldRouteToEditor =
        (parsedKey !== undefined && parsedKey.length === 1) ||
        matchesKey(data, Key.backspace) ||
        matchesKey(data, Key.delete) ||
        matchesKey(data, Key.space);
      if (!shouldRouteToEditor) return;
      this.setEditing(true);
    }
    this.editors[this.tab]!.handleInput(data);
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
      for (const wrappedLine of wrapTextWithAnsi(this.theme.fg("muted", question.reason), width)) {
        lines.add(wrappedLine);
      }
    }

    if (question.options.length > 0) {
      lines.space();
      lines.add(
        this.theme.fg(
          draft.editing ? "muted" : "accent",
          `Options ${draft.editing ? "[press Tab or ↑↓]" : "[selecting]"}`,
        ),
      );
      lines.space();
      for (const [index, option] of question.options.entries()) {
        const selected = draft.selectedIndexes.includes(index);
        const cursor = draft.cursor === index && !draft.editing;
        const marker = question.multi ? (selected ? "[x]" : "[ ]") : selected ? "(*)" : "( )";
        const prefix = cursor ? this.theme.fg("accent", "→") : " ";
        const recommendation =
          question.recommendedCount !== undefined && index < question.recommendedCount
            ? this.theme.fg("success", " [recommended]")
            : "";
        const exclusive = option.exclusive ? this.theme.fg("dim", " [exclusive]") : "";
        const optionText = `${marker} ${option.text}${recommendation}${exclusive}`;
        lines.add(`${prefix} ${cursor ? this.theme.fg("accent", optionText) : optionText}`);
        if (option.description) lines.add(this.theme.fg("muted", option.description), 6);
      }
    }

    lines.space();
    lines.add(
      this.theme.fg(
        draft.editing ? "accent" : "muted",
        `${question.placeholder} ${draft.editing ? "[editing]" : "[press Tab to edit]"}`,
      ),
    );
    for (const line of editor.render(Math.max(12, width - 2))) lines.add(line);

    const currentAnswer = serializeQuestionAnswer(question, draft);
    lines.space();
    lines.add(`${this.theme.fg("success", "Answer:")} ${summarizeAnswer(currentAnswer)}`);

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
    this.syncInteractionState();
  }

  private setEditing(editing: boolean) {
    const draft = this.drafts[this.tab]!;
    if (draft.editing === editing) return;
    draft.editing = editing;
    this.statusMessage = undefined;
    this.syncInteractionState();
  }

  private toggleFocusMode() {
    if (this.questions[this.tab]!.options.length === 0) return;
    this.setEditing(!this.drafts[this.tab]!.editing);
  }

  private handleVerticalNav(keyId: string) {
    const question = this.questions[this.tab]!;
    if (question.options.length === 0) return;

    const draft = this.drafts[this.tab]!;
    const oldCursor = draft.cursor;

    if (keyId === Key.down) {
      moveCursor(question, draft, 1);
      if (draft.cursor === oldCursor) {
        this.setEditing(true);
      }
      return;
    }

    moveCursor(question, draft, draft.editing ? 0 : -1);
    this.setEditing(false);
  }

  private toggleOption() {
    const question = this.questions[this.tab]!;
    const draft = this.drafts[this.tab]!;
    if (!question.multi || draft.editing) return;

    const result = toggleSuggestion(question, draft, draft.cursor);
    this.drafts[this.tab] = { ...draft, selectedIndexes: result.selectedIndexes };
    this.statusMessage = result.message;
  }

  private handleEnterKey() {
    const question = this.questions[this.tab]!;
    const draft = this.drafts[this.tab]!;
    if (question.options.length > 0 && !draft.editing && !question.multi) {
      this.drafts[this.tab] = { ...draft, selectedIndexes: [draft.cursor] };
    }
    this.submitAnswer();
  }

  private submitAnswer() {
    const question = this.questions[this.tab]!;
    const draft = this.drafts[this.tab]!;
    ensureSingleSelection(question, this.drafts[this.tab]!);

    const message = getValidationMessage(question, draft);
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

      this.tab = this.firstIncompleteIndex();
      this.syncInteractionState();
      return;
    }

    this.tab += 1;
    this.syncInteractionState();
  }

  private allQuestionsAnswered(): boolean {
    return this.questions.every(
      (question, index) => !getValidationMessage(question, this.drafts[index]!),
    );
  }

  private firstIncompleteIndex(): number {
    const index = this.questions.findIndex(
      (question, index) => !!getValidationMessage(question, this.drafts[index]!),
    );
    return index >= 0 ? index : this.questions.length - 1;
  }

  private renderTabs(): string {
    const tabs = this.questions.map((question, index) => {
      const answered = !getValidationMessage(question, this.drafts[index]!);
      const label = ` Q${index + 1}${answered ? "*" : ""} `;
      if (index === this.tab) {
        return this.theme.bg("selectedBg", this.theme.fg("text", label));
      }
      return this.theme.fg(answered ? "success" : "muted", label);
    });
    return tabs.join(" ");
  }

  private syncInteractionState() {
    this.syncEditorFocus();
    this.syncKeybindingState();
  }

  private syncKeybindingState() {
    const question = this.questions[this.tab]!;
    const draft = this.drafts[this.tab]!;
    const hasOptions = question.options.length > 0;
    const optionsFocused = hasOptions && !draft.editing;

    this.setArrowKeyAccess(
      { navigation: "horizontal", metakey: Key.alt },
      this.questions.length > 1,
    );
    this.setArrowKeyAccess({ navigation: "vertical" }, hasOptions);
    this.setKeyAccess(Key.tab, hasOptions);
    this.setKeyAccess(Key.space, optionsFocused && question.multi);

    this.setHint(Key.tab, optionsFocused ? "edit answer" : "select options");
    this.setHint(Key.up, optionsFocused ? "move options" : "focus options");
    this.setHint(Key.enter, optionsFocused && !question.multi ? "select + continue" : "continue");
  }

  private syncEditorFocus() {
    for (const [index, editor] of this.editors.entries()) {
      const draft = this.drafts[index]!;
      editor.focused = this.focused && index === this.tab && draft.editing;
    }
  }
}
