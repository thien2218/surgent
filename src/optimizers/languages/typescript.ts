import type { Language } from "tree-sitter";
import type { LanguageProfile, SymbolKindRule } from "./types.js";

const TYPESCRIPT_PROFILE_BASE: Omit<LanguageProfile, "loadLanguage"> = {
  nameField: "name",
  nameFieldByType: {},
  topLevelRoots: new Set(["program"]),
  topLevelParents: new Set(["lexical_declaration", "variable_declaration", "export_statement"]),
  typeRule: new Map<string, SymbolKindRule[]>([
    ["function_declaration", [{ kind: "function" }]],
    ["class_declaration", [{ kind: "class" }]],
    [
      "method_definition",
      [
        { kind: "class_method", parent: "class_body" },
        { kind: "object_method", parent: "object" },
      ],
    ],
    ["variable_declarator", [{ kind: "top_level_var", topLevelOnly: true }]],
  ]),
};

export const TYPESCRIPT_LANGUAGE_PROFILES = new Map<string, LanguageProfile>([
  [
    ".ts",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return languagePack.typescript as Language;
      },
    },
  ],
  [
    ".tsx",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return (languagePack.tsx ?? languagePack.typescript) as Language;
      },
    },
  ],
  [
    ".js",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return languagePack.typescript as Language;
      },
    },
  ],
  [
    ".mjs",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return languagePack.typescript as Language;
      },
    },
  ],
  [
    ".cjs",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return languagePack.typescript as Language;
      },
    },
  ],
  [
    ".jsx",
    {
      ...TYPESCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return (languagePack.tsx ?? languagePack.typescript) as Language;
      },
    },
  ],
]);
