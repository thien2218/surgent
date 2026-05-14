import type {
  NormalizedQuestion,
  Question,
  QuestionDraft,
  QuestionnaireParams,
  ToggleSelectionResult,
} from "./types.js";

const DEFAULT_PLACEHOLDER = "Type your answer";

export function normalizeQuestions(params: QuestionnaireParams): NormalizedQuestion[] {
  if (params.questions.length === 0) {
    throw new Error("At least one question is required.");
  }

  return params.questions.map((question) => normalizeQuestion(question));
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
  const recommendedOptionIndexes = getRecommendedOptionIndexes({ options, multi });
  const minSelections = multi
    ? Math.max(0, question.minSelections ?? recommendedOptionIndexes.length)
    : 0;
  const maxSelections = multi ? (question.maxSelections ?? options.length) : 1;

  if (multi && options.length === 0) {
    throw new Error(`Question "${prompt}" enables multi-select but does not provide any options.`);
  }

  if (multi && maxSelections < minSelections) {
    throw new Error(`Question "${prompt}" has minSelections greater than maxSelections.`);
  }

  if (multi && maxSelections > options.length) {
    throw new Error(`Question "${prompt}" has maxSelections larger than the number of options.`);
  }

  return {
    prompt,
    ...(question.reason?.trim() ? { reason: question.reason.trim() } : {}),
    options,
    placeholder: question.placeholder?.trim() || DEFAULT_PLACEHOLDER,
    multi,
    minSelections,
    maxSelections,
  };
}

function getRecommendedOptionIndexes(
  question: Pick<NormalizedQuestion, "options" | "multi">,
): number[] {
  const recommendedIndexes = question.options.flatMap((option, index) =>
    option.recommended ? [index] : [],
  );
  if (question.multi) {
    return recommendedIndexes;
  }
  return recommendedIndexes.length > 0 ? [recommendedIndexes[0]!] : [];
}

function clampCursorIndex(question: NormalizedQuestion, cursorIndex: number): number {
  if (question.options.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(question.options.length - 1, cursorIndex));
}
