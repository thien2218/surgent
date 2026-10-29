import type { Language, SyntaxNode } from "tree-sitter";
import { CFamilyLanguageProfile, C_TOP_LEVEL_PARENTS } from "./c.js";
import { loadGrammarModule } from "../ensure.js";
import type { SymbolKindRule } from "../types.js";

const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_specifier" },
  { kind: "method", container: "struct_specifier" },
  { kind: "method", container: "union_specifier" },
];

export class CppLanguageProfile extends CFamilyLanguageProfile {
  constructor() {
    super(
      // C headers parse as C++ too, while the C grammar breaks on C++ headers.
      new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"]),
      { __default__: "name" },
      new Set(["translation_unit"]),
      new Set([...C_TOP_LEVEL_PARENTS, "namespace_definition", "template_declaration"]),
      new Map<string, SymbolKindRule[]>([
        ["function_definition", [...MEMBER_RULES, { kind: "func", topLevelOnly: true }]],
        ["declaration", [...MEMBER_RULES, { kind: "decl", topLevelOnly: true }]],
        ["field_declaration", MEMBER_RULES],
        ["type_definition", [{ kind: "class", topLevelOnly: true }]],
        ["alias_declaration", [{ kind: "class", topLevelOnly: true }]],
        ["class_specifier", [{ kind: "class" }]],
        ["struct_specifier", [{ kind: "class" }]],
        ["union_specifier", [{ kind: "class" }]],
        ["enum_specifier", [{ kind: "class" }]],
        ["namespace_definition", [{ kind: "class" }]],
        ["preproc_function_def", [{ kind: "func", topLevelOnly: true }]],
        ["preproc_def", [{ kind: "decl", topLevelOnly: true }]],
        ["preproc_include", [{ kind: "deps", topLevelOnly: true }]],
        ["using_declaration", [{ kind: "deps", topLevelOnly: true }]],
        ["namespace_alias_definition", [{ kind: "deps", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-cpp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "using_declaration") {
      return this.readNodeText(node)
        ?.replace(/^using\s+/, "")
        .replace(/\s*;$/, "");
    }
    return super.readNodeName(node);
  }
}
