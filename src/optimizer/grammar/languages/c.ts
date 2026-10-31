import type { Language } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import type { SymbolKindRule } from "../types.js";
import { CFamilyLanguageProfile, C_TOP_LEVEL_PARENTS } from "./c-family.js";

const C_KINDS = ["struct", "union", "enum", "type", "macro"] as const;
type CKind = (typeof C_KINDS)[number];

export class CLanguageProfile extends CFamilyLanguageProfile<CKind> {
  readonly extensions = new Set([".c"]);
  readonly extraKinds = C_KINDS;
  protected readonly topLevelRoots = new Set(["translation_unit"]);
  protected readonly topLevelParents = new Set(C_TOP_LEVEL_PARENTS);
  protected readonly containerTypes = new Set([
    "function_definition",
    "declaration",
    "type_definition",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "preproc_function_def",
    "preproc_def",
    "preproc_include",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<CKind>[]>([
    ["function_definition", [{ kind: "func", topLevelOnly: true }]],
    [
      "declaration",
      [
        { kind: "func", topLevelOnly: true, match: (node) => this.isLonePrototype(node) },
        { kind: "decl", topLevelOnly: true, match: (node) => !this.declaresFunction(node) },
      ],
    ],
    ["type_definition", [{ kind: "type", topLevelOnly: true }]],
    ["struct_specifier", [{ kind: "struct", match: (node) => this.definesSpecifier(node) }]],
    ["union_specifier", [{ kind: "union", match: (node) => this.definesSpecifier(node) }]],
    ["enum_specifier", [{ kind: "enum", match: (node) => this.definesSpecifier(node) }]],
    ["preproc_function_def", [{ kind: "macro", topLevelOnly: true }]],
    [
      "preproc_def",
      [{ kind: "macro", topLevelOnly: true, match: (node) => this.definesMacro(node) }],
    ],
    ["preproc_include", [{ kind: "deps", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }
}
