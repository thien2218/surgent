import { Type } from "typebox";

// ==================== INPUT ====================

export interface QuestionOption {
  text: string;
  description?: string;
  exclusive?: boolean;
}

export interface Question {
  prompt: string;
  reason?: string;
  options?: QuestionOption[];

  placeholder?: string;
  multi?: boolean;
  recommendedCount?: number;

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
  recommendedCount?: number;
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
  description: Type.Optional(
    Type.String({ description: "Optional helper text shown under the option" }),
  ),
  exclusive: Type.Optional(
    Type.Boolean({
      description: "For multi questions, selecting this option clears other selected options",
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
  recommendedCount: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Number of top options treated as the agent's recommendation. For single-select with options this is always 1; for multi-select it must be at least minSelections.",
    }),
  ),
  minSelections: Type.Optional(
    Type.Integer({ minimum: 0, description: "Minimum selected options when multi is true" }),
  ),
  maxSelections: Type.Optional(
    Type.Integer({ minimum: 1, description: "Maximum selected options when multi is true" }),
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
