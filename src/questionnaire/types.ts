export interface QuestionOption {
  text: string;
  description?: string;
  exclusive?: boolean;
}

export interface Question {
  prompt: string;
  reason?: string;
  options?: QuestionOption[];

  placeholder: string;
  multi?: boolean;
  recommendedCount?: number;

  minSelections?: number;
  maxSelections?: number;
}

export interface QuestionnaireResult {
  cancelled: boolean;
  questions: string[];
  answers: string[];
}

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
  selectedIndexes: number[];
  cursor: number;
  editing: boolean;
}

export interface ToggleSelectionResult {
  selectedIndexes: number[];
  message?: string;
}
