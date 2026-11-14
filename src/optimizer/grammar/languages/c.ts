import type { Language } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import type { SymbolKindRule } from "../types.js";
import { CFamilyLanguageProfile, C_MEMBER_PARENTS, C_TOP_LEVEL_PARENTS } from "./c-family.js";

const C_KINDS = ["struct", "union", "enum", "type", "macro"] as const;
type CKind = (typeof C_KINDS)[number];

export class CLanguageProfile extends CFamilyLanguageProfile<CKind> {
  readonly extensions = new Set([".c"]);
  readonly extraKinds = C_KINDS;
  protected readonly topLevelRoots = new Set(["translation_unit"]);
  protected readonly topLevelParents = new Set(C_TOP_LEVEL_PARENTS);
  protected readonly memberParents = new Set(C_MEMBER_PARENTS);
  protected readonly containerTypes = new Set([
    "function_definition",
    "declaration",
    "type_definition",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "preproc_function_def",
    "preproc_def",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<CKind>[]>([
    ["function_definition", [{ kind: "func" }]],
    [
      "declaration",
      [{ kind: "decl", match: (node) => this.declaresVariable(node) }],
    ],
    ["type_definition", [{ kind: "type" }]],
    ["struct_specifier", this.nestSpecifier("struct")],
    ["union_specifier", this.nestSpecifier("union")],
    ["enum_specifier", this.nestSpecifier("enum")],
    ["preproc_function_def", [{ kind: "macro" }]],
    ["preproc_def", [{ kind: "macro", match: (node) => this.definesMacro(node) }]],
    ["preproc_include", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }
}
