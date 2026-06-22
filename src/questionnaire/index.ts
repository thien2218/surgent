import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { askQuestions, summarizeAnswer } from "./helpers.js";
import { QuestionnaireParamsSchema, type Question, type QuestionnaireResult } from "./types.js";

const questionnaire = defineTool({
  name: "questionnaire",
  label: "Questionnaire",
  description:
    "Ask user focused clarifying question(s) when answer changes next step. Prefer over guessing.",
  promptSnippet:
    "Clarify material unknowns with user. Ask 1 question or a small batch before committing.",
  promptGuidelines: [
    "Use when answer changes design, safety, scope, or next step.",
    "If multiple viable approaches remain, ask before choosing.",
    "If user invites questions, lower threshold.",
    "Ask 1 focused question or a small related batch.",
    "Prefer questionnaire over plain-text follow-up when UI is available.",
    "Do not ask what repo or prior answers already provide.",
  ],
  parameters: QuestionnaireParamsSchema,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (!ctx.hasUI) {
      return {
        content: [{ type: "text", text: "Questionnaire requires an interactive UI." }],
        details: { cancelled: true, questions: [], answers: [] } satisfies QuestionnaireResult,
      };
    }

    const result = await askQuestions(params.questions, ctx.ui);
    if (result.cancelled) {
      return {
        content: [{ type: "text", text: "User cancelled the questionnaire." }],
        details: result,
      };
    }

    const content = result.questions
      .map((question, idx) => `Q${idx + 1}: ${question}\nA${idx + 1}: ${result.answers[idx] ?? ""}`)
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
  pi.registerTool(questionnaire);
}
