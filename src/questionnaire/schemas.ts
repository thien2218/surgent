import Type from "typebox";

export const QuestionOptionSchema = Type.Object({
  text: Type.String({ minLength: 1, pattern: "\\S", description: "Option text" }),
  description: Type.Optional(Type.String({ description: "Option helper text" })),
  recommended: Type.Optional(Type.Boolean()),
  exclusive: Type.Optional(
    Type.Boolean({
      description: "If selected, clears other options",
    }),
  ),
});

export const QuestionSchema = Type.Object({
  prompt: Type.String({ pattern: "\\S", description: "Question text" }),
  reason: Type.Optional(Type.String({ description: "Why answer matters" })),
  options: Type.Optional(Type.Array(QuestionOptionSchema, { description: "Suggested options" })),
  placeholder: Type.Optional(
    Type.String({ pattern: "\\S", description: "Freeform input placeholder" }),
  ),
  multi: Type.Optional(
    Type.Boolean({
      description: "Allow selecting several options",
    }),
  ),
  minSelections: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Min options when multi",
    }),
  ),
  maxSelections: Type.Optional(Type.Integer({ minimum: 1, description: "Max options when multi" })),
});

export const QuestionnaireParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1 }),
});

export const QuestionnaireResultSchema = Type.Object({
  cancelled: Type.Boolean({
    description: "True if user cancelled questionnaire tool",
  }),
  answers: Type.Array(Type.String(), {
    description: "Final answers in questions order",
  }),
});
