export type EditorMode = "prompt" | "bash-included" | "bash-excluded";

export type ParsedText = {
  mode: EditorMode;
  displayText: string;
};

export function isBashMode(mode: EditorMode): boolean {
  return mode === "bash-included" || mode === "bash-excluded";
}

export function parseActualText(text: string): ParsedText {
  const excludedMatch = text.match(/^(\s*)!!(.*)$/s);
  if (excludedMatch) {
    return {
      mode: "bash-excluded",
      displayText: `${excludedMatch[1] ?? ""}${excludedMatch[2] ?? ""}`,
    };
  }

  const includedMatch = text.match(/^(\s*)!(.*)$/s);
  if (includedMatch) {
    return {
      mode: "bash-included",
      displayText: `${includedMatch[1] ?? ""}${includedMatch[2] ?? ""}`,
    };
  }

  return { mode: "prompt", displayText: text };
}

export function toActualText(text: string, mode: EditorMode): string {
  if (!isBashMode(mode)) {
    return text;
  }

  const match = text.match(/^(\s*)(.*)$/s);
  const bangPrefix = mode === "bash-excluded" ? "!!" : "!";
  return `${match?.[1] ?? ""}${bangPrefix}${match?.[2] ?? ""}`;
}
