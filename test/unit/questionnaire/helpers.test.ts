import { describe, expect, it } from "vitest";
import {
  createInitialDraft,
  ensureSingleSelection,
  getValidationMessage,
  moveCursor,
  normalizeQuestion,
  serializeQuestionAnswer,
  summarizeAnswer,
  toggleSuggestion,
} from "../../../src/questionnaire/helpers.js";
import type { Question, QuestionDraft } from "../../../src/questionnaire/types.js";

function question(overrides: Partial<Question> = {}) {
  return normalizeQuestion({ prompt: "Choose a route", placeholder: "Your answer", ...overrides });
}

function draft(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return { text: "", selectedIndexes: [], cursor: 0, editing: false, ...overrides };
}

describe("question normalization", () => {
  it("trims display fields without changing option order or metadata", () => {
    const options = [
      { text: "Second choice", description: "Details", recommended: true },
      { text: "First choice", exclusive: true },
    ];

    const normalized = question({ prompt: "  Choose  ", reason: "  Why  ", placeholder: "  Explain  ", options });

    expect(normalized).toEqual({
      prompt: "Choose", reason: "Why", placeholder: "Explain", options,
      multi: false, minSelections: 1, maxSelections: 1,
    });
  });

  it.each([undefined, []])("treats multi-select without options (%j) as freeform", (options) => {
    expect(question({ options, multi: true, minSelections: 2, maxSelections: 3 })).toMatchObject({
      options: [], multi: false, minSelections: 1, maxSelections: 1,
    });
  });

  it("defaults multi-select bounds without inventing recommendations", () => {
    const normalized = question({ multi: true, options: [{ text: "First" }, { text: "Second" }] });

    expect(normalized).toMatchObject({ minSelections: 1, maxSelections: 2 });
    expect(normalized.options).toEqual([{ text: "First" }, { text: "Second" }]);
  });

  it("ignores multi-select bounds for single-select questions", () => {
    expect(question({ options: [{ text: "Only" }], minSelections: 2, maxSelections: 3 }))
      .toMatchObject({ multi: false, minSelections: 1, maxSelections: 1 });
  });

  it.each([false, true])("allows fewer recommendations than the minimum (recommended=%s)", (recommended) => {
    const normalized = question({
      multi: true, minSelections: 2,
      options: [{ text: "First", recommended }, { text: "Second" }],
    });

    expect(normalized.minSelections).toBe(2);
    expect(normalized.options[0]?.recommended).toBe(recommended);
  });

  it.each([
    { name: "minimum above maximum", bounds: { minSelections: 2, maxSelections: 1 }, error: /minSelections greater than maxSelections/ },
    { name: "maximum above option count", bounds: { maxSelections: 3 }, error: /maxSelections larger than the number of options/ },
  ])("rejects $name", ({ bounds, error }) => {
    expect(() => question({ multi: true, options: [{ text: "First" }, { text: "Second" }], ...bounds }))
      .toThrow(error);
  });

  it.each([false, true])("rejects recommendations exceeding the selection cap (multi=%s)", (multi) => {
    expect(() => question({
      multi, maxSelections: 1,
      options: [{ text: "First", recommended: true }, { text: "Second", recommended: true }],
    })).toThrow(/more recommended options than maxSelections/);
  });

  it("accepts recommendations exactly at the selection cap", () => {
    expect(() => question({
      multi: true, minSelections: 2, maxSelections: 2,
      options: [{ text: "First", recommended: true }, { text: "Second", recommended: true }],
    })).not.toThrow();
  });

  it.each([false, true])("rejects an exclusive multi-select recommendation even when other recommendations=%s", (recommended) => {
    expect(() => question({
      multi: true,
      options: [{ text: "None", exclusive: true, recommended: true }, { text: "Other", recommended }],
    })).toThrow(/cannot recommend an exclusive option/);
  });

  it("allows unmarked exclusive choices and exclusive single-select recommendations", () => {
    expect(() => question({ multi: true, options: [{ text: "None", exclusive: true }] })).not.toThrow();
    expect(() => question({ options: [{ text: "None", exclusive: true, recommended: true }] })).not.toThrow();
  });
});

describe("initial answers", () => {
  it("starts freeform questions in editing mode with an empty answer", () => {
    expect(createInitialDraft(question())).toEqual(draft({ editing: true }));
  });

  it("focuses the recommended single-select option without selecting it", () => {
    const normalized = question({ options: [{ text: "First" }, { text: "Second", recommended: true }] });

    expect(createInitialDraft(normalized)).toEqual(draft({ cursor: 1 }));
  });

  it("preselects only marked multi-select options wherever they appear", () => {
    const normalized = question({ multi: true, options: [
      { text: "First", recommended: false }, { text: "Second", recommended: true },
      { text: "Third" }, { text: "Fourth", recommended: true },
    ] });

    expect(createInitialDraft(normalized)).toEqual(draft({ selectedIndexes: [1, 3], cursor: 1 }));
  });

  it("leaves unmarked options unselected and gives each draft independent state", () => {
    const normalized = question({ multi: true, options: [{ text: "First" }, { text: "Second" }] });
    const first = createInitialDraft(normalized);
    const second = createInitialDraft(normalized);
    first.selectedIndexes.push(1);
    first.text = "Changed";

    expect(second).toEqual(draft());
    expect(normalized.options.every((option) => !option.recommended)).toBe(true);
  });
});

describe("answer validation", () => {
  it.each(["", "  \n\t"])("rejects blank freeform text %j", (text) => {
    expect(getValidationMessage(question(), draft({ text }))).toMatch(/Type an answer/);
  });

  it("rejects unanswered single-select questions", () => {
    expect(getValidationMessage(question({ options: [{ text: "First" }] }), draft())).toMatch(/Select.*or type/);
  });

  it.each([
    { name: "typed freeform answer", input: {}, answer: { text: "  Answer  " } },
    { name: "single selection", input: { options: [{ text: "First" }] }, answer: { selectedIndexes: [0] } },
    { name: "typed single-select answer", input: { options: [{ text: "First" }] }, answer: { text: "Other" } },
    { name: "typed multi-select answer below minimum", input: { multi: true, minSelections: 2, options: [{ text: "First" }, { text: "Second" }] }, answer: { text: "Other" } },
    { name: "multi-select answer at both bounds", input: { multi: true, minSelections: 2, maxSelections: 2, options: [{ text: "First" }, { text: "Second" }] }, answer: { selectedIndexes: [0, 1] } },
  ])("accepts $name", ({ input, answer }) => {
    expect(getValidationMessage(question(input), draft(answer))).toBeUndefined();
  });

  it("requires at least one multi-select option when typed text is blank", () => {
    const normalized = question({ multi: true, options: [{ text: "First" }] });

    expect(getValidationMessage(normalized, draft({ text: " \n " }))).toMatch(/Select one or more/);
  });

  it("rejects a nonempty selection below its minimum", () => {
    const normalized = question({ multi: true, minSelections: 2, options: [{ text: "First" }, { text: "Second" }] });

    expect(getValidationMessage(normalized, draft({ selectedIndexes: [0] }))).toMatch(/Select at least 2 options/);
  });

  it.each(["", "Custom answer"])("does not let typed text %j bypass the selection maximum", (text) => {
    const normalized = question({ multi: true, maxSelections: 1, options: [{ text: "First" }, { text: "Second" }] });

    expect(getValidationMessage(normalized, draft({ text, selectedIndexes: [0, 1] }))).toMatch(/Select at most 1 option,/);
  });
});

describe("answer serialization", () => {
  it.each([
    { name: "trimmed text takes precedence", text: "  Custom  ", selectedIndexes: [0], expected: "Custom" },
    { name: "blank text falls back to the selection", text: " \n ", selectedIndexes: [1], expected: "Second" },
    { name: "unanswered questions stay empty", text: "", selectedIndexes: [], expected: "" },
    { name: "missing options do not leak undefined", text: "", selectedIndexes: [9], expected: "" },
  ])("single-select: $name", ({ text, selectedIndexes, expected }) => {
    const normalized = question({ options: [{ text: "First" }, { text: "Second" }] });

    expect(serializeQuestionAnswer(normalized, draft({ text, selectedIndexes }))).toBe(expected);
  });

  it.each([
    { name: "selection order precedes trimmed text", selectedIndexes: [2, 0], text: "  Extra  ", expected: "Second\nFirst\nExtra" },
    { name: "duplicate option labels appear once", selectedIndexes: [0, 1, 2], text: "", expected: "First\nSecond" },
    { name: "matching custom text is not repeated", selectedIndexes: [0], text: " First ", expected: "First" },
    { name: "invalid indexes are skipped", selectedIndexes: [9, 2], text: "", expected: "Second" },
    { name: "text-only answers are allowed", selectedIndexes: [], text: "  Extra  ", expected: "Extra" },
    { name: "empty answers stay empty", selectedIndexes: [], text: " \n ", expected: "" },
  ])("multi-select: $name", ({ selectedIndexes, text, expected }) => {
    const normalized = question({ multi: true, options: [{ text: "First" }, { text: "First" }, { text: "Second" }] });

    expect(serializeQuestionAnswer(normalized, draft({ selectedIndexes, text }))).toBe(expected);
  });

  it.each([
    ["  First \n  Second  ", "First / Second"],
    ["First\n\nSecond", "First / Second"],
    ["  One line  ", "One line"],
    ["", ""],
  ])("summarizes %j as %j", (answer, expected) => {
    expect(summarizeAnswer(answer)).toBe(expected);
  });
});

describe("selection changes", () => {
  it("replaces the previous single selection", () => {
    const normalized = question({ options: [{ text: "First" }, { text: "Second" }] });

    expect(toggleSuggestion(normalized, draft({ selectedIndexes: [0] }), 1)).toEqual({ selectedIndexes: [1] });
  });

  it.each([
    { name: "adds an unselected option", selectedIndexes: [], index: 0, expected: [0] },
    { name: "removes a selected option", selectedIndexes: [0, 1], index: 0, expected: [1] },
    { name: "exclusive selection clears normal selections", selectedIndexes: [0, 1], index: 2, expected: [2] },
    { name: "normal selection clears exclusive selection", selectedIndexes: [2], index: 1, expected: [1] },
    { name: "removes an exclusive selection", selectedIndexes: [2], index: 2, expected: [] },
    { name: "ignores missing options", selectedIndexes: [0], index: 9, expected: [0] },
  ])("$name without mutating the previous draft", ({ selectedIndexes, index, expected }) => {
    const normalized = question({ multi: true, maxSelections: 2, options: [
      { text: "First" }, { text: "Second" }, { text: "None", exclusive: true },
    ] });
    const previous = draft({ selectedIndexes: [...selectedIndexes] });

    expect(toggleSuggestion(normalized, previous, index)).toEqual({ selectedIndexes: expected });
    expect(previous.selectedIndexes).toEqual(selectedIndexes);
  });

  it.each([1, 2])("preserves selections and reports the maximum of %s", (maxSelections) => {
    const normalized = question({ multi: true, maxSelections, options: [
      { text: "First" }, { text: "Second" }, { text: "Third" },
    ] });
    const selectedIndexes = Array.from({ length: maxSelections }, (_value, index) => index);

    expect(toggleSuggestion(normalized, draft({ selectedIndexes }), maxSelections)).toEqual({
      selectedIndexes, message: `Select at most ${maxSelections} option${maxSelections === 1 ? "" : "s"}.`,
    });
  });

  it("allows a normal option to replace an exclusive selection at the maximum", () => {
    const normalized = question({ multi: true, maxSelections: 1, options: [{ text: "None", exclusive: true }, { text: "Other" }] });

    expect(toggleSuggestion(normalized, draft({ selectedIndexes: [0] }), 1)).toEqual({ selectedIndexes: [1] });
  });

  it("confirms the cursor only for single-select questions", () => {
    const single = draft({ cursor: 1 });
    const multiple = draft({ cursor: 1, selectedIndexes: [0] });
    const freeform = draft({ text: "Answer" });
    const options = [{ text: "First" }, { text: "Second" }];

    ensureSingleSelection(question({ options }), single);
    ensureSingleSelection(question({ options, multi: true }), multiple);
    ensureSingleSelection(question(), freeform);

    expect(single.selectedIndexes).toEqual([1]);
    expect(multiple.selectedIndexes).toEqual([0]);
    expect(freeform.selectedIndexes).toEqual([]);
  });

  it.each([
    { cursor: 0, delta: -1, expected: 0 },
    { cursor: 0, delta: 1, expected: 1 },
    { cursor: 1, delta: 1, expected: 1 },
    { cursor: 1, delta: -1, expected: 0 },
  ])("clamps cursor $cursor + $delta to $expected", ({ cursor, delta, expected }) => {
    const answer = draft({ cursor });

    moveCursor(question({ options: [{ text: "First" }, { text: "Second" }] }), answer, delta);

    expect(answer.cursor).toBe(expected);
  });

  it("does not move a freeform question's cursor", () => {
    const answer = draft();

    moveCursor(question(), answer, 1);

    expect(answer.cursor).toBe(0);
  });
});
