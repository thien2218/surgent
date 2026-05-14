import { Type } from "typebox";

// ==================== INPUT ====================

export interface QuestionOption {
  text: string;
  recommended?: boolean;
  description?: string;
  exclusive?: boolean;
}

export interface Question {
  prompt: string;
  reason?: string;
  options?: QuestionOption[];

  placeholder?: string;
  multi?: boolean;

  minSelections?: number;
  maxSelections?: number;
}

export interface QuestionnaireParams {
  questions: Question[];
}

// ==================== OUTPUT (for agent) ====================

export interface QuestionnaireResult {
  cancelled: boolean;
  answers: string[];
}

// ==================== INTERNAL UI STATE ====================

export type FocusMode = "editor" | "options";

export interface NormalizedQuestion {
  prompt: string;
  reason?: string;
  options: QuestionOption[];
  placeholder: string;
  multi: boolean;
  minSelections: number;
  maxSelections: number;
}

export interface QuestionDraft {
  text: string;
  selectedOptionIndexes: number[];
  cursorIndex: number;
  focusMode: FocusMode;
}

export interface ToggleSelectionResult {
  selectedOptionIndexes: number[];
  message?: string;
}

// ==================== VALIDATION ====================

export const QuestionOptionSchema = Type.Object({
  text: Type.String({ description: "Suggested answer text shown to the user" }),
  recommended: Type.Optional(
    Type.Boolean({
      description: "Whether this suggestion should be treated as the default fallback",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Optional helper text shown under the suggestion" }),
  ),
  exclusive: Type.Optional(
    Type.Boolean({
      description: "For multi questions, selecting this option clears other selected suggestions",
    }),
  ),
});

export const QuestionSchema = Type.Object({
  prompt: Type.String({ description: "The question shown to the user" }),
  reason: Type.Optional(
    Type.String({
      description: "Short explanation shown to the user for why the answer is needed",
    }),
  ),
  options: Type.Optional(
    Type.Array(QuestionOptionSchema, {
      description:
        "Optional suggested answers that the user can select instead of typing from scratch",
    }),
  ),
  placeholder: Type.Optional(
    Type.String({ description: "Placeholder text shown in the free-form answer editor" }),
  ),
  multi: Type.Optional(
    Type.Boolean({ description: "Whether multiple suggested answers may be selected together" }),
  ),
  minSelections: Type.Optional(
    Type.Integer({ minimum: 0, description: "Minimum selected suggestions when multi is true" }),
  ),
  maxSelections: Type.Optional(
    Type.Integer({ minimum: 1, description: "Maximum selected suggestions when multi is true" }),
  ),
});

export const QuestionnaireParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    description: "Questions to ask in one questionnaire session",
  }),
});

export const QuestionnaireResultSchema = Type.Object({
  cancelled: Type.Boolean({
    description: "Whether the questionnaire was aborted before submission",
  }),
  answers: Type.Array(Type.String(), {
    description: "One final answer string per question, in input order; empty when cancelled",
  }),
});
