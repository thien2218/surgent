import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { askQuestions } from "./helpers.js";
import type { Question, QuestionnaireResult } from "./types.js";
import { renderCallText } from "../utils.js";
import { QuestionnaireParamsSchema } from "./schemas.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
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
          .map(
            (question, idx) =>
              `Q${idx + 1}: ${question}\nA${idx + 1}: ${result.answers[idx] ?? ""}`,
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: content }],
          details: result,
        };
      },
      renderCall(args, theme, { isPartial }) {
        const questions = ((args.questions as Question[] | undefined) ?? []).filter(Boolean);
        const count = questions.length;
        let text = `${theme.fg("toolTitle", "questionnaire")} ${theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`)}`;
        return renderCallText(text, isPartial);
      },
    }),
  );
}
