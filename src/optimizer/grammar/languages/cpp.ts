import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import type { SymbolKindRule } from "../types.js";
import { CFamilyLanguageProfile, C_TOP_LEVEL_PARENTS, MEMBER_RULES } from "./c-family.js";

const CPP_KINDS = ["class", "struct", "union", "enum", "namespace", "type", "macro"] as const;
type CppKind = (typeof CPP_KINDS)[number];

export class CppLanguageProfile extends CFamilyLanguageProfile<CppKind> {
  // C headers parse as C++ too, while the C grammar breaks on C++ headers.
  readonly extensions = new Set([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"]);
  readonly extraKinds = CPP_KINDS;
  protected readonly topLevelRoots = new Set(["translation_unit"]);
  protected readonly topLevelParents = new Set([
    ...C_TOP_LEVEL_PARENTS,
    "namespace_definition",
    "template_declaration",
  ]);
  protected readonly containerTypes = new Set([
    "function_definition",
    "declaration",
    "field_declaration",
    "type_definition",
    "alias_declaration",
    "class_specifier",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "namespace_definition",
    "preproc_function_def",
    "preproc_def",
    "preproc_include",
    "using_declaration",
    "namespace_alias_definition",
  ]);
  private readonly memberPrototypes = MEMBER_RULES.map((rule) => ({
    ...rule,
    match: (node: SyntaxNode) => this.isLonePrototype(node),
  }));
  protected readonly rules = new Map<string, SymbolKindRule<CppKind>[]>([
    [
      "function_definition",
      [
        ...MEMBER_RULES,
        { kind: "method", topLevelOnly: true, match: (node) => this.declaresMethod(node) },
        { kind: "func", topLevelOnly: true },
      ],
    ],
    [
      "declaration",
      [
        ...this.memberPrototypes,
        {
          kind: "method",
          topLevelOnly: true,
          match: (node) => this.declaresMethod(node) && this.isLonePrototype(node),
        },
        { kind: "func", topLevelOnly: true, match: (node) => this.isLonePrototype(node) },
        { kind: "decl", topLevelOnly: true, match: (node) => !this.declaresFunction(node) },
      ],
    ],
    ["field_declaration", this.memberPrototypes],
    ["type_definition", [{ kind: "type", topLevelOnly: true }]],
    ["alias_declaration", [{ kind: "type", topLevelOnly: true }]],
    ["class_specifier", [{ kind: "class", match: (node) => this.definesSpecifier(node) }]],
    ["struct_specifier", [{ kind: "struct", match: (node) => this.definesSpecifier(node) }]],
    ["union_specifier", [{ kind: "union", match: (node) => this.definesSpecifier(node) }]],
    ["enum_specifier", [{ kind: "enum", match: (node) => this.definesSpecifier(node) }]],
    ["namespace_definition", [{ kind: "namespace" }]],
    ["preproc_function_def", [{ kind: "macro", topLevelOnly: true }]],
    [
      "preproc_def",
      [{ kind: "macro", topLevelOnly: true, match: (node) => this.definesMacro(node) }],
    ],
    ["preproc_include", [{ kind: "deps", topLevelOnly: true }]],
    ["using_declaration", [{ kind: "deps", topLevelOnly: true }]],
    ["namespace_alias_definition", [{ kind: "deps", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-cpp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "using_declaration") {
      return readNodeText(node)
        ?.replace(/^using\s+/, "")
        .replace(/\s*;$/, "");
    }
    return super.readNodeName(node);
  }
}
