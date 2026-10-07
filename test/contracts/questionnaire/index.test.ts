import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import questionnaire from "../../../src/questionnaire/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

function setup() {
  const recorded = recordExtension();
  questionnaire(recorded.api);
  return { tool: recorded.tool("questionnaire"), ...commandContext("/unused") };
}

const question = { prompt: "What should change?", placeholder: "Your answer" };

describe("questionnaire tool parameters", () => {
  it("registers an interactive clarification tool with optional per-option recommendations", () => {
    const { tool } = setup();
    const properties = tool.parameters.properties.questions.items.properties;

    expect(tool.label).toBe("Questionnaire");
    expect(tool.exposure).toBe("model-only");
    expect(tool.description).toContain("clarifying");
    expect(properties).not.toHaveProperty("recommendedCount");
    expect(properties.placeholder.default).toBe("Type your answer");
    expect(properties.options.items.properties.recommended.type).toBe("boolean");
  });

  it.each([
    { name: "missing question list", params: {} },
    { name: "empty question list", params: { questions: [] } },
    { name: "non-array question list", params: { questions: "Question" } },
    { name: "missing prompt", params: { questions: [{ placeholder: "Answer" }] } },
    { name: "empty prompt", params: { questions: [{ ...question, prompt: "" }] } },
    { name: "whitespace prompt", params: { questions: [{ ...question, prompt: " \n\t" }] } },
    { name: "missing placeholder", params: { questions: [{ prompt: "Question" }] } },
    { name: "empty placeholder", params: { questions: [{ ...question, placeholder: "" }] } },
    { name: "whitespace placeholder", params: { questions: [{ ...question, placeholder: "  " }] } },
    { name: "missing option text", params: { questions: [{ ...question, options: [{}] }] } },
    { name: "empty option text", params: { questions: [{ ...question, options: [{ text: "" }] }] } },
    { name: "whitespace option text", params: { questions: [{ ...question, options: [{ text: "\t" }] }] } },
    { name: "non-array options", params: { questions: [{ ...question, options: "First" }] } },
    { name: "non-boolean multi", params: { questions: [{ ...question, multi: "yes" }] } },
    { name: "non-boolean recommendation", params: { questions: [{ ...question, options: [{ text: "First", recommended: "yes" }] }] } },
    { name: "non-boolean exclusivity", params: { questions: [{ ...question, options: [{ text: "First", exclusive: 1 }] }] } },
  ])("schema rejects $name", ({ params }) => {
    const { tool } = setup();

    expect(Check(tool.parameters, params)).toBe(false);
  });

  it.each(["minSelections", "maxSelections"])("schema requires %s to be a positive integer", (field) => {
    const { tool } = setup();

    for (const value of [0, -1, 1.5, "1", null]) {
      expect(Check(tool.parameters, { questions: [{ ...question, [field]: value }] }), `${field}=${value}`).toBe(false);
    }
    expect(Check(tool.parameters, { questions: [{ ...question, [field]: 1 }] })).toBe(true);
  });

  it.each([
    { name: "freeform with omitted optional fields", input: question },
    { name: "multi without options", input: { ...question, multi: true } },
    { name: "empty options", input: { ...question, options: [] } },
    { name: "unmarked choices", input: { ...question, options: [{ text: "First" }] } },
    { name: "explicit recommendation flags", input: { ...question, options: [{ text: "First", recommended: false }, { text: "Second", recommended: true }] } },
    { name: "optional explanatory text", input: { ...question, reason: "Reason", options: [{ text: "First", description: "Details", exclusive: true }] } },
  ])("schema accepts $name", ({ input }) => {
    const { tool } = setup();

    expect(Check(tool.parameters, { questions: [input] })).toBe(true);
  });
});

describe("questionnaire tool execution", () => {
  it("does not open a custom prompt when interactive UI is unavailable", async () => {
    const { tool, ctx, ui } = setup();

    const result = await tool.execute("no-ui", { questions: [question] }, undefined, undefined, { ...ctx, hasUI: false });

    expect(result.content).toEqual([{ type: "text", text: "Questionnaire requires an interactive UI." }]);
    expect(result.details).toBeUndefined();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("reports refusal without opening UI when execution is already aborted", async () => {
    const { tool, ctx, ui } = setup();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute("aborted", { questions: [question] }, controller.signal, undefined, ctx);

    expect(result.content).toEqual([{ type: "text", text: "User refused to answer the questionnaire." }]);
    expect(result.details).toBeUndefined();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("connects normalized prompts and recommendation selections to numbered tool output", async () => {
    const { tool, ctx, ui, interact } = setup();
    interact((component) => {
      component.handleInput!("Ship the feature");
      component.handleInput!("\r");
      component.handleInput!("\r");
      component.handleInput!("\r");
    });

    const result = await tool.execute("answered", { questions: [
      { ...question, prompt: "  Goal?  " },
      { ...question, prompt: "Choices?", multi: true, options: [
        { text: "Unmarked" }, { text: "Alpha", recommended: true }, { text: "Beta", recommended: true },
      ] },
    ] }, undefined, undefined, ctx);

    expect(result).toEqual({
      content: [{ type: "text", text: "Q1: Goal?\nA1: Ship the feature\n\nQ2: Choices?\nA2: Alpha\nBeta" }],
      details: undefined,
    });
    expect(ui.custom).toHaveBeenCalledTimes(1);
  });

  it("propagates Escape refusal without exposing an unfinished answer", async () => {
    const { tool, ctx, interact } = setup();
    interact((component) => {
      component.handleInput!("Unfinished answer");
      component.handleInput!("\x1b");
    });

    const result = await tool.execute("refused", { questions: [question] }, new AbortController().signal, undefined, ctx);

    expect(result).toEqual({
      content: [{ type: "text", text: "User refused to answer the questionnaire." }], details: undefined,
    });
  });

  it("propagates cross-field validation failures before creating UI", async () => {
    const { tool, ctx, ui } = setup();
    const params = { questions: [{ ...question, multi: true, maxSelections: 2, options: [{ text: "Only" }] }] };
    expect(Check(tool.parameters, params)).toBe(true);

    await expect(tool.execute("invalid", params, undefined, undefined, ctx)).rejects.toThrow(/maxSelections larger/);

    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("propagates UI failures instead of reporting a successful or refused answer", async () => {
    const { tool, ctx, ui } = setup();
    const error = new Error("Custom UI unavailable");
    ui.custom.mockRejectedValueOnce(error);

    await expect(tool.execute("failed", { questions: [question] }, undefined, undefined, ctx)).rejects.toBe(error);
  });
});

describe("questionnaire tool-call rendering", () => {
  it.each([
    { name: "missing partial arguments", args: {}, count: "0 questions" },
    { name: "one question", args: { questions: [question] }, count: "1 question" },
    { name: "multiple questions", args: { questions: [question, question] }, count: "2 questions" },
    { name: "incomplete array entries", args: { questions: [null, question, undefined] }, count: "1 question" },
  ])("renders $name", ({ args, count }) => {
    const { tool, ui } = setup();

    const rendered = tool.renderCall!(args, ui.theme, { isPartial: true } as Parameters<NonNullable<typeof tool.renderCall>>[2]);

    expect(rendered.render(100).map(stripTerminalSequences).join("\n").trim()).toBe(`questionnaire ${count}`);
  });

  it("adds final spacing only after call arguments are complete", () => {
    const { tool, ui } = setup();
    const args = { questions: [question] };

    const partial = tool.renderCall!(args, ui.theme, { isPartial: true } as Parameters<NonNullable<typeof tool.renderCall>>[2]).render(100);
    const complete = tool.renderCall!(args, ui.theme, { isPartial: false } as Parameters<NonNullable<typeof tool.renderCall>>[2]).render(100);

    expect(complete).toEqual([...partial, ""]);
  });
});
