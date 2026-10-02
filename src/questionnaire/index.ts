import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Questionnaire from "./component.js";
import { normalizeQuestion } from "./helpers.js";
import type { Question, QuestionnaireResult } from "./types.js";
import { renderCallText } from "../utils.js";
import { QuestionnaireParamsSchema } from "./schemas.js";
import type { TextContent } from "@earendil-works/pi-ai";

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
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        if (!ctx.hasUI) {
          return {
            content: [{ type: "text", text: "Questionnaire requires an interactive UI." }],
            details: undefined,
          };
        }

        const refusal = {
          content: [
            { type: "text", text: "User refused to answer the questionnaire." },
          ] as TextContent[],
          details: undefined,
        };
        if (signal?.aborted) return refusal;

        const normalized = params.questions.map(normalizeQuestion);
        const result = await ctx.ui.custom<QuestionnaireResult | null>(
          (tui, theme, _keybindings, done) => {
            const component = new Questionnaire(tui, theme, normalized);
            component.onDone = done;
            return component;
          },
        );
        if (!result) return refusal;

        const content = result.questions
          .map(
            (question, idx) =>
              `Q${idx + 1}: ${question}\nA${idx + 1}: ${result.answers[idx] ?? ""}`,
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: content }],
          details: undefined,
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
