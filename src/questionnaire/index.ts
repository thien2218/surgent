import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { createQuestionnaireComponent } from "./component.js";
import { normalizeQuestions, summarizeAnswer } from "./helpers.js";
import { QuestionnaireParamsSchema, type Question, type QuestionnaireResult } from "./types.js";

const questionnaireTool = defineTool({
  name: "questionnaire",
  label: "Questionnaire",
  description: "Ask focused clarifying questions. Returns one answer per question.",
  promptSnippet: "Ask focused clarifying questions. Returns one answer per question.",
  promptGuidelines: [
    "Use questionnaire only when missing info changes next step.",
    "questionnaire can batch related questions in one call.",
    "Use questionnaire with few high-signal questions.",
    "Use questionnaire only for gaps not already answered.",
  ],
  parameters: QuestionnaireParamsSchema,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (!ctx.hasUI) {
      return {
        content: [{ type: "text", text: "Questionnaire requires an interactive UI." }],
        details: { cancelled: true, answers: [] } satisfies QuestionnaireResult,
      };
    }

    const questions = normalizeQuestions(params);
    const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _keybindings, done) =>
      createQuestionnaireComponent({
        tui,
        theme,
        questions,
        onDone: done,
      }),
    );

    if (result.cancelled) {
      return {
        content: [{ type: "text", text: "User cancelled the questionnaire." }],
        details: result,
      };
    }

    const content = questions
      .map(
        (question, index) =>
          `Q${index + 1}: ${question.prompt}\nA${index + 1}: ${result.answers[index] ?? ""}`,
      )
      .join("\n\n");

    return {
      content: [{ type: "text", text: content }],
      details: result,
    };
  },
  renderCall(args, theme) {
    const questions = ((args.questions as Question[] | undefined) ?? []).filter(Boolean);
    const count = questions.length;
    const preview = questions[0]?.prompt ?? "";
    let text = theme.fg("toolTitle", theme.bold("questionnaire "));
    text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
    if (preview) {
      text += theme.fg("dim", ` (${preview.slice(0, 50)}${preview.length > 50 ? "..." : ""})`);
    }
    return new Text(text, 0, 0);
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Questionnaire in progress..."), 0, 0);
    }

    const details = result.details as QuestionnaireResult | undefined;
    if (!details) {
      const firstBlock = result.content[0];
      return new Text(firstBlock?.type === "text" ? firstBlock.text : "", 0, 0);
    }

    if (details.cancelled) {
      return new Text(theme.fg("warning", "Cancelled"), 0, 0);
    }

    const lines = details.answers.map(
      (answer, index) => `${theme.fg("success", `${index + 1}.`)} ${summarizeAnswer(answer)}`,
    );
    return new Text(lines.join("\n"), 0, 0);
  },
});

export default function registerQuestionnaireTool(pi: ExtensionAPI) {
  pi.registerTool(questionnaireTool);
}
