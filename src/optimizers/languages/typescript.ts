import type { Language } from "tree-sitter";
import type { LanguageProfile, SymbolKindRule } from "./types.js";

const TYPE_SCRIPT_PROFILE_BASE: Omit<LanguageProfile, "loadLanguage"> = {
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

export const TYPE_SCRIPT_LANGUAGE_PROFILES = new Map<string, LanguageProfile>([
  [
    ".ts",
    {
      ...TYPE_SCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return languagePack.typescript as Language;
      },
    },
  ],
  [
    ".tsx",
    {
      ...TYPE_SCRIPT_PROFILE_BASE,
      loadLanguage: async () => {
        const languagePack = await import("tree-sitter-typescript");
        return (languagePack.tsx ?? languagePack.typescript) as Language;
      },
    },
  ],
]);
