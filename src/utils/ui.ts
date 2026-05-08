import type { EditorComponent, Focusable } from "@earendil-works/pi-tui";

export type EditorMode = "prompt" | "bash";

export type ParsedText = {
  mode: EditorMode;
  displayText: string;
};

export function parseActualText(text: string): ParsedText {
  const match = text.match(/^(\s*)!(.*)$/s);
  if (!match) {
    return { mode: "prompt", displayText: text };
  }

  return {
    mode: "bash",
    displayText: `${match[1] ?? ""}${match[2] ?? ""}`,
  };
}

export function toActualText(text: string, mode: EditorMode): string {
  if (mode !== "bash") {
    return text;
  }

  const match = text.match(/^(\s*)(.*)$/s);
  return `${match?.[1] ?? ""}!${match?.[2] ?? ""}`;
}

export function isFocusable(
  editor: EditorComponent,
): editor is EditorComponent & Focusable {
  return "focused" in editor;
}
