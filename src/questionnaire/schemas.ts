import Type from "typebox";

export const QuestionOptionSchema = Type.Object({
  text: Type.String({ description: "Option text" }),
  description: Type.Optional(Type.String({ description: "Option helper text" })),
  exclusive: Type.Optional(
    Type.Boolean({
      description: "If selected, clears other options",
    }),
  ),
});

export const QuestionSchema = Type.Object({
  prompt: Type.String({ description: "Question text" }),
  reason: Type.Optional(Type.String({ description: "Why answer matters" })),
  options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Suggested options" })),
  placeholder: Type.String({
    description: "Freeform input placeholder",
    default: "Type your answer",
  }),
  multi: Type.Optional(Type.Boolean({ description: "Allow multiple options" })),
  recommendedCount: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Recommended options count",
    }),
  ),
  minSelections: Type.Optional(
    Type.Integer({ minimum: 0, description: "Min options to select (if multi=true)" }),
  ),
  maxSelections: Type.Optional(
    Type.Integer({ minimum: 1, description: "Max options to select (if multi=true)" }),
  ),
});

export const QuestionnaireParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    description: "Questions to ask",
  }),
});

export const QuestionnaireResultSchema = Type.Object({
  cancelled: Type.Boolean({
    description: "True if user cancelled questionnaire tool",
  }),
  answers: Type.Array(Type.String(), {
    description: "Final answers in questions order",
  }),
});
