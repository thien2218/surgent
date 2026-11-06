import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { nestRule } from "../profile.js";
import type { SymbolKindRule } from "../types.js";
import {
  CFamilyLanguageProfile,
  C_MEMBER_PARENTS,
  C_TOP_LEVEL_PARENTS,
  MEMBER_RULES,
  TYPE_CONTAINERS,
} from "./c-family.js";

const CPP_KINDS = ["class", "struct", "union", "enum", "namespace", "type", "macro"] as const;
type CppKind = (typeof CPP_KINDS)[number];

const METHOD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasBody }));

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
  protected readonly rules = new Map<string, SymbolKindRule<CppKind>[]>([
    [
      "function_definition",
      [
        ...METHOD_RULES,
        { kind: "method", match: (node) => hasBody(node) && this.declaresMethod(node) },
        { kind: "func", match: hasBody },
      ],
    ],
    [
      "declaration",
      [
        { kind: "func", match: bindsLambda },
        { kind: "decl", match: (node) => this.declaresVariable(node) },
      ],
    ],
    ["type_definition", nestRule({ kind: "type" }, TYPE_CONTAINERS)],
    ["alias_declaration", nestRule({ kind: "type" }, TYPE_CONTAINERS)],
    ["class_specifier", this.nestSpecifier("class")],
    ["struct_specifier", this.nestSpecifier("struct")],
    ["union_specifier", this.nestSpecifier("union")],
    ["enum_specifier", this.nestSpecifier("enum")],
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

  protected findDeclarationStart(node: SyntaxNode) {
    let startNode = node;
    while (startNode.parent?.type === "template_declaration") {
      startNode = startNode.parent;
    }
    return startNode;
  }
}

function hasBody(node: SyntaxNode) {
  return node.childForFieldName("body") !== null;
}

function bindsLambda(node: SyntaxNode) {
  const declarator = node.childForFieldName("declarator");
  return declarator?.childForFieldName("value")?.type === "lambda_expression";
}
