import type {
  NormalizedQuestion,
  Question,
  QuestionDraft,
  QuestionOption,
  QuestionnaireParams,
  ToggleSelectionResult,
} from "./types.js";

const DEFAULT_PLACEHOLDER = "Type your answer";

export function normalizeQuestions(params: QuestionnaireParams): NormalizedQuestion[] {
  if (params.questions.length === 0) {
    throw new Error("At least one question is required.");
  }
  return params.questions.map(normalizeQuestion);
}

export function createInitialDraft(question: NormalizedQuestion): QuestionDraft {
  const selectedOptionIndexes = getRecommendedOptionIndexes(question);

  return {
    text: "",
    selectedOptionIndexes,
    cursorIndex: selectedOptionIndexes[0] ?? 0,
    focusMode: question.options.length > 0 ? "options" : "editor",
  };
}

export function getQuestionValidationMessage(
  question: NormalizedQuestion,
  draft: QuestionDraft,
): string | undefined {
  const trimmedText = draft.text.trim();
  const selectedCount = draft.selectedOptionIndexes.length;

  if (question.multi && selectedCount > question.maxSelections) {
    return `Select at most ${question.maxSelections} suggestion${question.maxSelections === 1 ? "" : "s"}, or type your answer.`;
  }
  if (trimmedText) {
    return undefined;
  }
  if (question.options.length === 0) {
    return "Type an answer to continue.";
  }
  if (!question.multi) {
    return selectedCount > 0 ? undefined : "Select a suggestion or type an answer to continue.";
  }
  if (selectedCount === 0) {
    return "Select one or more suggestions, or type an answer to continue.";
  }
  if (selectedCount < question.minSelections) {
    return `Select at least ${question.minSelections} suggestion${question.minSelections === 1 ? "" : "s"}, or type an answer.`;
  }

  return undefined;
}

export function isQuestionComplete(question: NormalizedQuestion, draft: QuestionDraft): boolean {
  return getQuestionValidationMessage(question, draft) === undefined;
}

export function serializeQuestionAnswer(
  question: NormalizedQuestion,
  draft: QuestionDraft,
): string {
  const trimmedText = draft.text.trim();
  const selectedTexts = draft.selectedOptionIndexes
    .map((index) => question.options[index]?.text)
    .filter((value): value is string => Boolean(value));

  if (!question.multi) {
    return trimmedText || selectedTexts[0] || "";
  }

  const lines: string[] = [];

  for (const text of selectedTexts) {
    if (!lines.includes(text)) {
      lines.push(text);
    }
  }

  if (trimmedText && !lines.includes(trimmedText)) {
    lines.push(trimmedText);
  }

  return lines.join("\n");
}

export function summarizeAnswer(answer: string): string {
  return answer.replace(/\s*\n\s*/g, " / ").trim();
}

export function toggleSuggestion(
  question: NormalizedQuestion,
  draft: QuestionDraft,
  optionIndex: number,
): ToggleSelectionResult {
  if (!question.multi) {
    return { selectedOptionIndexes: [optionIndex] };
  }

  const option = question.options[optionIndex];
  if (!option) {
    return { selectedOptionIndexes: draft.selectedOptionIndexes };
  }

  const currentlySelected = draft.selectedOptionIndexes.includes(optionIndex);
  if (currentlySelected) {
    return {
      selectedOptionIndexes: draft.selectedOptionIndexes.filter((index) => index !== optionIndex),
    };
  }

  if (option.exclusive) {
    return { selectedOptionIndexes: [optionIndex] };
  }

  const withoutExclusive = draft.selectedOptionIndexes.filter(
    (index) => !question.options[index]?.exclusive,
  );
  if (withoutExclusive.length >= question.maxSelections) {
    return {
      selectedOptionIndexes: draft.selectedOptionIndexes,
      message: `Select at most ${question.maxSelections} suggestion${question.maxSelections === 1 ? "" : "s"}.`,
    };
  }

  return { selectedOptionIndexes: [...withoutExclusive, optionIndex] };
}

export function ensureSingleSelection(
  question: NormalizedQuestion,
  draft: QuestionDraft,
): QuestionDraft {
  if (question.multi || question.options.length === 0 || draft.selectedOptionIndexes.length > 0) {
    return draft;
  }

  const nextCursorIndex = clampCursorIndex(question, draft.cursorIndex);
  return {
    ...draft,
    selectedOptionIndexes: [nextCursorIndex],
  };
}

export function moveCursor(
  question: NormalizedQuestion,
  draft: QuestionDraft,
  delta: number,
): QuestionDraft {
  if (question.options.length === 0) {
    return draft;
  }

  const lastIndex = question.options.length - 1;
  return {
    ...draft,
    cursorIndex: Math.max(0, Math.min(lastIndex, draft.cursorIndex + delta)),
  };
}

function normalizeQuestion(question: Question): NormalizedQuestion {
  const prompt = question.prompt.trim();
  if (!prompt) {
    throw new Error("Question prompt must not be empty.");
  }

  const options = question.options ?? [];
  const multi = question.multi === true && options.length > 0;
  const minSelections = multi ? (question.minSelections ?? 1) : 1;
  const maxSelections = multi ? (question.maxSelections ?? options.length) : 1;
  const recommendedCount = getRecommendedCount({
    options,
    multi,
    minSelections,
    recommendedCount: question.recommendedCount,
  });

  if (multi && options.length === 0) {
    throw new Error(`Question "${prompt}" enables multi-select but does not provide any options.`);
  }
  if (multi && maxSelections < minSelections) {
    throw new Error(`Question "${prompt}" has minSelections greater than maxSelections.`);
  }
  if (multi && maxSelections > options.length) {
    throw new Error(`Question "${prompt}" has maxSelections larger than the number of options.`);
  }
  if (
    !multi &&
    options.length > 0 &&
    question.recommendedCount !== undefined &&
    question.recommendedCount !== 1
  ) {
    throw new Error(`Question "${prompt}" must use recommendedCount: 1 for single-select options.`);
  }
  if (multi && recommendedCount !== undefined && recommendedCount < minSelections) {
    throw new Error(
      `Question "${prompt}" must have recommendedCount greater than or equal to minSelections.`,
    );
  }
  if (recommendedCount !== undefined && recommendedCount > options.length) {
    throw new Error(`Question "${prompt}" has recommendedCount larger than the number of options.`);
  }
  if (options.length > 0 && recommendedCount === undefined) {
    throw new Error(
      `Question "${prompt}" must provide recommended options at the top of the list.`,
    );
  }
  if (options.length > 0 && recommendedCount !== undefined && recommendedCount < 1) {
    throw new Error(
      `Question "${prompt}" must recommend at least one option when suggestions are provided.`,
    );
  }

  return {
    prompt,
    reason: question.reason?.trim(),
    options,
    placeholder: question.placeholder?.trim() || DEFAULT_PLACEHOLDER,
    multi,
    recommendedCount,
    minSelections,
    maxSelections,
  };
}

function getRecommendedOptionIndexes(
  question: Pick<NormalizedQuestion, "options" | "recommendedCount">,
): number[] {
  if (!question.recommendedCount) {
    return [];
  }

  return question.options.slice(0, question.recommendedCount).map((_option, index) => index);
}

function getRecommendedCount(question: {
  options: QuestionOption[];
  multi: boolean;
  minSelections: number;
  recommendedCount?: number;
}): number | undefined {
  if (question.options.length === 0) {
    return undefined;
  }
  if (!question.multi) {
    return 1;
  }
  return question.recommendedCount ?? question.minSelections;
}

function clampCursorIndex(question: NormalizedQuestion, cursorIndex: number): number {
  if (question.options.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(question.options.length - 1, cursorIndex));
}
