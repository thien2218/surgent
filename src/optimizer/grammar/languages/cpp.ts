import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import type { SymbolKindRule } from "../types.js";
import {
  CFamilyLanguageProfile,
  C_MEMBER_PARENTS,
  C_TOP_LEVEL_PARENTS,
  MEMBER_RULES,
} from "./c-family.js";

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
  protected readonly memberParents = new Set([...C_MEMBER_PARENTS, "template_declaration"]);
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
  ]);
  private readonly abstractMethods = MEMBER_RULES.map((rule) => ({
    ...rule,
    match: (node: SyntaxNode) => this.declaresFunction(node) && isPureVirtual(node),
  }));
  protected readonly rules = new Map<string, SymbolKindRule<CppKind>[]>([
    [
      "function_definition",
      [
        ...MEMBER_RULES,
        { kind: "method", match: (node) => this.declaresMethod(node) },
        { kind: "func" },
      ],
    ],
    [
      "declaration",
      [
        { kind: "func", match: bindsLambda },
        { kind: "decl", match: (node) => this.declaresVariable(node) },
      ],
    ],
    ["field_declaration", [...this.abstractMethods, ...this.fieldRules]],
    ["type_definition", [{ kind: "type" }]],
    ["alias_declaration", [{ kind: "type" }]],
    ["class_specifier", [{ kind: "class", match: (node) => this.definesSpecifier(node) }]],
    ["struct_specifier", [{ kind: "struct", match: (node) => this.definesSpecifier(node) }]],
    ["union_specifier", [{ kind: "union", match: (node) => this.definesSpecifier(node) }]],
    ["enum_specifier", [{ kind: "enum", match: (node) => this.definesSpecifier(node) }]],
    ["namespace_definition", [{ kind: "namespace" }]],
    ["preproc_function_def", [{ kind: "macro" }]],
    ["preproc_def", [{ kind: "macro", match: (node) => this.definesMacro(node) }]],
    ["preproc_include", [{ kind: "import" }]],
    ["using_declaration", [{ kind: "import" }]],
    ["namespace_alias_definition", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-cpp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  findBodyNodes(node: SyntaxNode) {
    if (node.type !== "declaration") return super.findBodyNodes(node);
    return node.childrenForFieldName("declarator").flatMap((declarator) => {
      const valueNode = declarator.childForFieldName("value");
      return valueNode?.type === "lambda_expression"
        ? (valueNode.childForFieldName("body") ?? [])
        : [];
    });
  }

  findStartNode(node: SyntaxNode) {
    let startNode = node;
    while (startNode.parent?.type === "template_declaration") {
      startNode = startNode.parent;
    }
    return startNode;
  }
}

function isPureVirtual(node: SyntaxNode) {
  return node.childForFieldName("default_value")?.text === "0";
}

function bindsLambda(node: SyntaxNode) {
  const declarator = node.childForFieldName("declarator");
  return declarator?.childForFieldName("value")?.type === "lambda_expression";
}
