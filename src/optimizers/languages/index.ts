import { GoLanguageProfile } from "./go.js";
import { JavaLanguageProfile } from "./java.js";
import { PythonLanguageProfile } from "./python.js";
import { TypeScriptLanguageProfile } from "./typescript.js";
import type { LanguageProfile } from "./types.js";

const LANGUAGE_PROFILES: LanguageProfile[] = [
  new GoLanguageProfile(),
  new JavaLanguageProfile(),
  new PythonLanguageProfile(),
  new TypeScriptLanguageProfile(),
];

const PROFILE_BY_EXTENSION = new Map<string, LanguageProfile>();
for (const languageProfile of LANGUAGE_PROFILES) {
  for (const extension of languageProfile.extensions) {
    PROFILE_BY_EXTENSION.set(extension, languageProfile);
  }
}

export function getLanguageProfile(extension: string) {
  return PROFILE_BY_EXTENSION.get(extension);
}

export function getSupportedExtensions() {
  return new Set(PROFILE_BY_EXTENSION.keys());
}

export { collectSymbols } from "./symbols.js";
export type { LanguageProfile, LanguageSymbol } from "./types.js";
export const SYMBOL_KINDS = [
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
  "import",
  "export",
] as const;
