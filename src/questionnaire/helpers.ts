import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import Questionnaire from "./component.js";
import type {
  NormalizedQuestion,
  Question,
  QuestionDraft,
  QuestionnaireResult,
  QuestionOption,
  ToggleSelectionResult,
} from "./types.js";

export function createInitialDraft(question: NormalizedQuestion): QuestionDraft {
  const selectedIndexes = question.multi
    ? question.options.slice(0, question.recommendedCount).map((_option, index) => index)
    : [];

  return {
    text: "",
    selectedIndexes,
    cursor: selectedIndexes[0] ?? 0,
    editing: question.options.length === 0,
  };
}

export function getValidationMessage(
  question: NormalizedQuestion,
  draft: QuestionDraft,
): string | undefined {
  const trimmedText = draft.text.trim();
  const selectedCount = draft.selectedIndexes.length;

  if (question.multi && selectedCount > question.maxSelections) {
    return `Select at most ${question.maxSelections} option${question.maxSelections === 1 ? "" : "s"}, or type your answer.`;
  }
  if (trimmedText) {
    return undefined;
  }
  if (question.options.length === 0) {
    return "Type an answer to continue.";
  }
  if (!question.multi) {
    return selectedCount > 0 ? undefined : "Select a option or type an answer to continue.";
  }
  if (selectedCount === 0) {
    return "Select one or more options, or type an answer to continue.";
  }
  if (selectedCount < question.minSelections) {
    return `Select at least ${question.minSelections} option${question.minSelections === 1 ? "" : "s"}, or type an answer.`;
  }
  return undefined;
}

export function serializeQuestionAnswer(
  question: NormalizedQuestion,
  draft: QuestionDraft,
): string {
  const trimmedText = draft.text.trim();
  const selectedTexts = draft.selectedIndexes
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
    return { selectedIndexes: [optionIndex] };
  }

  const option = question.options[optionIndex];
  if (!option) {
    return { selectedIndexes: draft.selectedIndexes };
  }

  const currentlySelected = draft.selectedIndexes.includes(optionIndex);
  if (currentlySelected) {
    return {
      selectedIndexes: draft.selectedIndexes.filter((index) => index !== optionIndex),
    };
  }

  if (option.exclusive) {
    return { selectedIndexes: [optionIndex] };
  }

  const withoutExclusive = draft.selectedIndexes.filter(
    (index) => !question.options[index]?.exclusive,
  );
  if (withoutExclusive.length >= question.maxSelections) {
    return {
      selectedIndexes: draft.selectedIndexes,
      message: `Select at most ${question.maxSelections} option${question.maxSelections === 1 ? "" : "s"}.`,
    };
  }

  return { selectedIndexes: [...withoutExclusive, optionIndex] };
}

export function ensureSingleSelection(question: NormalizedQuestion, draft: QuestionDraft) {
  if (question.multi || question.options.length === 0) return draft;
  draft.selectedIndexes = [draft.cursor];
}

export function moveCursor(question: NormalizedQuestion, draft: QuestionDraft, delta: number) {
  if (question.options.length === 0) return draft;
  draft.cursor = Math.max(0, Math.min(question.options.length - 1, draft.cursor + delta));
}

export async function askQuestions(questions: Question[], ui: ExtensionUIContext) {
  if (questions.length === 0) {
    throw new Error("At least one question is required.");
  }

  const normalized = questions.map(normalizeQuestion);
  return ui.custom<QuestionnaireResult>((tui, theme, _keybindings, done) => {
    const component = new Questionnaire(tui, theme, normalized);
    component.onDone = done;
    return component;
  });
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
      `Question "${prompt}" must recommend at least one option when options are provided.`,
    );
  }

  return {
    prompt,
    reason: question.reason?.trim(),
    options,
    placeholder: question.placeholder.trim(),
    multi,
    recommendedCount,
    minSelections,
    maxSelections,
  };
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
