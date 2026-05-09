export type EditorMode = "prompt" | "bash-included" | "bash-excluded";

export type ParsedText = {
  mode: EditorMode;
  displayText: string;
};
