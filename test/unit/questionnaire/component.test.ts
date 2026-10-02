import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import Questionnaire from "../../../src/questionnaire/component.js";
import { normalizeQuestion } from "../../../src/questionnaire/helpers.js";
import type { Question } from "../../../src/questionnaire/types.js";
import { commandContext } from "../../helpers/commands.js";

const keys = {
  enter: "\r", escape: "\x1b", tab: "\t", space: " ",
  up: "\x1b[A", down: "\x1b[B", previous: "\x1b[1;3D", next: "\x1b[1;3C",
};

function createQuestionnaire(questions: Question[]) {
  const { tui, ui } = commandContext("/unused");
  const component = new Questionnaire(tui, ui.theme, questions.map(normalizeQuestion));
  const done = vi.fn<NonNullable<Questionnaire["onDone"]>>();
  component.onDone = done;
  return { component, done };
}

function text(component: Questionnaire, width = 100) {
  return component.render(width).map(stripTerminalSequences).join("\n");
}

function question(overrides: Partial<Question> = {}): Question {
  return { prompt: "Choose a route", placeholder: "Your answer", ...overrides };
}

describe("questionnaire navigation and submission", () => {
  it("keeps question drafts across tabs and submits ordered answers only from review", () => {
    const { component, done } = createQuestionnaire([
      question({ prompt: "First question" }), question({ prompt: "Second question" }),
    ]);

    component.handleInput(keys.previous);
    component.handleInput("First answer");
    component.handleInput(keys.next);
    expect(text(component)).toContain("Second question");
    component.handleInput("Second answer");
    component.handleInput(keys.previous);
    expect(text(component)).toContain("Answer: First answer");
    expect(text(component)).toContain("Q1*");
    component.handleInput(keys.enter);
    expect(text(component)).toContain("Answer: Second answer");
    component.handleInput(keys.enter);
    component.handleInput(keys.next);
    const review = text(component);
    expect(review).toContain("Review answers");
    expect(review).toContain("Q1: First question");
    expect(review).toContain("A2: Second answer");
    expect(review).toContain("Press Enter to submit.");
    expect(done).not.toHaveBeenCalled();

    component.handleInput("ignored");
    component.handleInput(keys.space);
    component.handleInput(keys.tab);
    expect(text(component)).toBe(review);
    component.handleInput(keys.enter);

    expect(done).toHaveBeenCalledExactlyOnceWith({
      questions: ["First question", "Second question"], answers: ["First answer", "Second answer"],
    });
  });

  it("returns incomplete review to the first unanswered question with its validation reason", () => {
    const { component, done } = createQuestionnaire([
      question({ prompt: "Answered question" }), question({ prompt: "Missing answer" }), question({ prompt: "Later question" }),
    ]);
    component.handleInput("Done");
    component.handleInput(keys.enter);
    component.handleInput(keys.next);
    component.handleInput(keys.next);
    expect(text(component)).toContain("A2: (incomplete)");
    expect(text(component)).toContain("Complete required answers before submitting.");

    component.handleInput(keys.enter);

    expect(text(component)).toContain("Missing answer");
    expect(text(component)).not.toContain("Later question");
    expect(text(component)).toContain("Type an answer to continue.");
    expect(done).not.toHaveBeenCalled();
  });

  it.each([false, true])("Escape discards partial answers from review=%s", (review) => {
    const { component, done } = createQuestionnaire([question()]);
    component.handleInput("Partial answer");
    if (review) component.handleInput(keys.enter);

    component.handleInput(keys.escape);

    expect(done).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("Enter confirms the focused single-select option", () => {
    const { component, done } = createQuestionnaire([question({
      options: [{ text: "First" }, { text: "Second", recommended: true }],
    })]);

    component.handleInput(keys.enter);
    expect(text(component)).toContain("A1: Second");
    expect(done).not.toHaveBeenCalled();
    component.handleInput(keys.enter);

    expect(done).toHaveBeenCalledExactlyOnceWith({ questions: ["Choose a route"], answers: ["Second"] });
  });

  it("Enter does not implicitly select a focused multi-select option", () => {
    const { component, done } = createQuestionnaire([question({ multi: true, options: [{ text: "First" }] })]);

    component.handleInput(keys.enter);

    expect(text(component)).toContain("Select one or more options");
    expect(text(component)).not.toContain("Review answers");
    expect(done).not.toHaveBeenCalled();
    component.handleInput(keys.space);
    expect(text(component)).toContain("[x] First");
    expect(text(component)).not.toContain("Select one or more options");
    component.handleInput(keys.enter);
    expect(text(component)).toContain("Review answers");
  });
});

describe("questionnaire editing and option focus", () => {
  it("Tab switches between options and text without losing either answer", () => {
    const { component, done } = createQuestionnaire([question({
      multi: true, options: [{ text: "First", recommended: true }, { text: "Second" }],
    })]);

    component.handleInput(keys.tab);
    component.handleInput(keys.space);
    component.handleInput("Custom");
    expect(text(component)).toContain("Your answer [editing]");
    component.handleInput(keys.tab);
    expect(text(component)).toContain("Options [selecting]");
    expect(text(component)).toContain("[x] First");
    expect(text(component)).toContain("Answer: First / Custom");
    component.handleInput(keys.enter);
    component.handleInput(keys.enter);

    expect(done).toHaveBeenCalledExactlyOnceWith({ questions: ["Choose a route"], answers: ["First\nCustom"] });
  });

  it.each(["x", keys.space, "\x7f", "\x1b[3~"])("input %j enters text editing from options", (input) => {
    const { component } = createQuestionnaire([question({ options: [{ text: "First" }] })]);

    component.handleInput(input);

    expect(text(component)).toContain("Your answer [editing]");
    expect(text(component)).not.toContain("Options [selecting]");
  });

  it("does not leave option selection for an unrelated function key", () => {
    const { component } = createQuestionnaire([question({ options: [{ text: "First" }] })]);
    const before = text(component);

    component.handleInput("\x1bOP");

    expect(text(component)).toBe(before);
  });

  it("freeform questions stay editable without option focus controls", () => {
    const { component } = createQuestionnaire([question({ multi: true })]);

    component.handleInput(keys.tab);
    component.handleInput("Answer");

    expect(text(component)).toContain("Your answer [editing]");
    expect(text(component)).not.toContain("Options [");
    expect(text(component)).toContain("Answer: Answer");
  });

  it("moves through options, enters editing below the last option, and restores its cursor with Up", () => {
    const { component } = createQuestionnaire([question({ options: [{ text: "First" }, { text: "Second" }] })]);

    component.handleInput(keys.up);
    expect(text(component)).toContain("→ ( ) First");
    component.handleInput(keys.down);
    expect(text(component)).toContain("→ ( ) Second");
    component.handleInput(keys.down);
    expect(text(component)).toContain("Your answer [editing]");
    component.handleInput(keys.up);
    expect(text(component)).toContain("→ ( ) Second");
    component.handleInput(keys.up);
    expect(text(component)).toContain("→ ( ) First");
  });

  it("keeps Down in editing mode while advancing the option cursor, then Up restores option focus", () => {
    const { component } = createQuestionnaire([question({ options: [{ text: "First" }, { text: "Second" }] })]);
    component.handleInput(keys.tab);
    component.handleInput("Draft");

    component.handleInput(keys.down);
    expect(text(component)).toContain("Your answer [editing]");
    component.handleInput(keys.up);

    expect(text(component)).toContain("→ ( ) Second");
    expect(text(component)).toContain("Answer: Draft");
  });

  it("shows the editor cursor only while its question has editing focus", () => {
    const { component } = createQuestionnaire([question({ options: [{ text: "First" }] })]);
    component.focused = true;
    expect(component.render(100).join("\n")).not.toContain(CURSOR_MARKER);

    component.handleInput(keys.tab);
    expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
    component.handleInput(keys.next);
    expect(component.render(100).join("\n")).not.toContain(CURSOR_MARKER);
    component.handleInput(keys.previous);
    expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
    component.focused = false;
    expect(component.render(100).join("\n")).not.toContain(CURSOR_MARKER);
  });
});

describe("questionnaire feedback", () => {
  it("shows validation after invalid submission and clears it when text changes", () => {
    const { component, done } = createQuestionnaire([question()]);

    component.handleInput(keys.enter);
    expect(text(component)).toContain("Type an answer to continue.");
    expect(done).not.toHaveBeenCalled();
    component.handleInput("Answer");

    expect(text(component)).not.toContain("Type an answer to continue.");
    expect(text(component)).toContain("Q1*");
  });

  it("shows minimum-selection feedback even when the question has optional recommendations", () => {
    const { component } = createQuestionnaire([question({
      multi: true, minSelections: 2,
      options: [{ text: "First", recommended: true }, { text: "Second" }],
    })]);

    component.handleInput(keys.enter);

    expect(text(component)).toContain("Select at least 2 options");
  });

  it("shows selection-limit feedback without changing selections and clears it after a valid toggle", () => {
    const { component } = createQuestionnaire([question({
      multi: true, maxSelections: 1,
      options: [{ text: "First", recommended: true }, { text: "Second" }],
    })]);
    component.handleInput(keys.down);

    component.handleInput(keys.space);
    expect(text(component)).toContain("Select at most 1 option.");
    expect(text(component)).toContain("[x] First");
    expect(text(component)).toContain("[ ] Second");
    component.handleInput(keys.up);
    component.handleInput(keys.space);

    expect(text(component)).not.toContain("Select at most 1 option.");
    expect(text(component)).toContain("[ ] First");
  });

  it("renders reasons, descriptions and per-option labels without inventing recommendations", () => {
    const { component } = createQuestionnaire([question({
      reason: "Explain the tradeoff", multi: true,
      options: [
        { text: "First", description: "First details" },
        { text: "Second", recommended: true },
        { text: "None", exclusive: true },
      ],
    })]);

    const output = text(component);

    expect(output).toContain("Explain the tradeoff");
    expect(output).toContain("First details");
    expect(output).toContain("Second [recommended]");
    expect(output).not.toContain("First [recommended]");
    expect(output).toContain("None [exclusive]");
  });

  it("wraps prompt, reason and validation text within a narrow render width", () => {
    const { component } = createQuestionnaire([question({
      prompt: "Explain which approach should be selected for this task",
      reason: "This answer determines which implementation is appropriate",
    })]);
    component.handleInput(keys.enter);

    const lines = component.render(32);
    const output = lines.map(stripTerminalSequences).join(" ");

    expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(output).toContain("implementation");
    expect(output).toContain("Type an answer to continue.");
  });
});
