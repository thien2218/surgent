/**
 * Temporary extension for manual UI component testing.
 * Register a /test command here and remove this directory when done.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import QuestionnaireComponent from "../questionnaire/component.js";
import { normalizeQuestions } from "../questionnaire/helpers.js";

const questions = normalizeQuestions({
  questions: [
    {
      prompt: "Should we proceed with the refactor?",
      reason: "The current architecture makes it hard to add new features.",
      placeholder: "Type your answer",
      options: [
        { text: "Yes, go ahead" },
        { text: "Yes, but scope it down", description: "Only touch the core module" },
        { text: "No, not now" },
      ],
    },
    {
      prompt: "Which areas should be prioritized?",
      placeholder: "Describe the areas",
      multi: true,
      recommendedCount: 2,
      options: [
        { text: "Authentication" },
        { text: "Database layer" },
        { text: "API surface" },
        { text: "None of the above", exclusive: true },
      ],
    },
  ],
});

export default function tempExtension(pi: ExtensionAPI) {
  pi.registerCommand("test", {
    description: "Test UI components",
    handler: async (_args, ctx) => {
      const result = await ctx.ui.custom<string[] | null>((tui, theme, _kb, done) => {
        const component = new QuestionnaireComponent(tui, theme, questions);
        component.onDone = ({ cancelled, answers }) => done(cancelled ? null : answers);
        return component;
      });

      if (result === null) {
        ctx.ui.notify("Cancelled", "info");
      } else {
        for (const [i, answer] of result.entries()) {
          ctx.ui.notify(`Q${i + 1}: ${answer}`, "info");
        }
      }
    },
  });
}
