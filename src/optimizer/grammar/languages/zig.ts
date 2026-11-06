import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { nestRule, RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const ZIG_KINDS = ["struct", "enum", "union", "type"] as const;
type ZigKind = (typeof ZIG_KINDS)[number];

const TYPE_VALUES = new Set(["opaque_declaration", "error_set_declaration"]);
const CONTAINER_VALUES = new Set([
  "struct_declaration",
  "enum_declaration",
  "union_declaration",
  "opaque_declaration",
]);
const TYPE_CONTAINERS = ["variable_declaration", "function_declaration"];
const IMPORT_BUILTINS = new Set(["@import", "@cImport"]);

export class ZigLanguageProfile extends RuleBasedLanguageProfile<ZigKind> {
  readonly extensions = new Set([".zig"]);
  readonly extraKinds = ZIG_KINDS;
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly memberParents = new Set([
    "struct_declaration",
    "enum_declaration",
    "union_declaration",
    "opaque_declaration",
    "block",
    "expression_statement",
    "return_expression",
  ]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "variable_declaration",
    "test_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<ZigKind>[]>([
    [
      "function_declaration",
      [
        // Types are structs bound to constants, or returned by generic type functions.
        { kind: "method", container: "variable_declaration", match: hasBody },
        { kind: "method", container: "function_declaration", match: hasBody },
        { kind: "func", match: hasBody },
      ],
    ],
    [
      "variable_declaration",
      [
        ...nestRule(
          { kind: "struct", match: (node) => this.readValue(node)?.type === "struct_declaration" },
          TYPE_CONTAINERS,
        ),
        ...nestRule(
          { kind: "enum", match: (node) => this.readValue(node)?.type === "enum_declaration" },
          TYPE_CONTAINERS,
        ),
        ...nestRule(
          { kind: "union", match: (node) => this.readValue(node)?.type === "union_declaration" },
          TYPE_CONTAINERS,
        ),
        ...nestRule(
          { kind: "type", match: (node) => TYPE_VALUES.has(this.readValue(node)?.type ?? "") },
          TYPE_CONTAINERS,
        ),
        { kind: "import", match: (node) => this.bindsImport(node) },
        { kind: "decl", match: (node) => !isExtern(node) && !this.bindsImport(node) },
      ],
    ],
    ["test_declaration", [{ kind: "func" }]],
    ["using_namespace_declaration", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("@tree-sitter-grammars/tree-sitter-zig");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "variable_declaration") {
      return readNodeText(node.namedChildren.find((childNode) => childNode.type === "identifier"));
    }
    if (node.type === "test_declaration") {
      const label = node.namedChildren.find((childNode) => childNode.type !== "block");
      return label ? `test ${label.text}` : "test";
    }
    return this.readNameField(node);
  }

  private readValue(node: SyntaxNode) {
    const assignIndex = node.children.findIndex((childNode) => childNode.type === "=");
    if (assignIndex < 0) return;
    return node.children.slice(assignIndex + 1).find((childNode) => childNode.isNamed);
  }

  protected matchesRule(node: SyntaxNode, rule: SymbolKindRule<ZigKind>) {
    // Function bodies reach generic type containers, but their own declarations are locals.
    if (rule.container && !CONTAINER_VALUES.has(node.parent?.type ?? "")) return false;
    return super.matchesRule(node, rule);
  }

  private bindsImport(node: SyntaxNode) {
    const value = this.readValue(node);
    return value && node.parent ? this.isImport(value, node.parent) : false;
  }

  private isImport(node: SyntaxNode, scope: SyntaxNode, seenNames = new Set<string>()): boolean {
    if (node.type === "builtin_function") {
      return IMPORT_BUILTINS.has(node.namedChild(0)?.text ?? "");
    }
    if (node.type === "field_expression") {
      const objectNode = node.childForFieldName("object");
      return objectNode ? this.isImport(objectNode, scope, seenNames) : false;
    }
    if (node.type !== "identifier" || seenNames.has(node.text)) return false;
    seenNames.add(node.text);

    const binding = scope.namedChildren.find(
      (childNode) =>
        childNode.type === "variable_declaration" && this.readNodeName(childNode) === node.text,
    );
    const value = binding && this.readValue(binding);
    return value ? this.isImport(value, scope, seenNames) : false;
  }
}

function hasBody(node: SyntaxNode) {
  return node.childForFieldName("body") !== null;
}

function isExtern(node: SyntaxNode) {
  return node.children.some((childNode) => childNode.type === "extern");
}
