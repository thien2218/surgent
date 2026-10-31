import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const ZIG_KINDS = ["struct", "enum", "union", "type"] as const;
type ZigKind = (typeof ZIG_KINDS)[number];

const TYPE_VALUES = new Set([
  "struct_declaration",
  "enum_declaration",
  "union_declaration",
  "opaque_declaration",
  "error_set_declaration",
]);
const IMPORT_BUILTINS = new Set(["@import", "@cImport"]);

export class ZigLanguageProfile extends RuleBasedLanguageProfile<ZigKind> {
  readonly extensions = new Set([".zig"]);
  readonly extraKinds = ZIG_KINDS;
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "variable_declaration",
    "test_declaration",
    "using_namespace_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<ZigKind>[]>([
    [
      "function_declaration",
      [
        // Types are structs bound to constants, or returned by generic type functions.
        { kind: "method", container: "variable_declaration" },
        { kind: "method", container: "function_declaration" },
        { kind: "func", topLevelOnly: true },
      ],
    ],
    [
      "variable_declaration",
      [
        { kind: "type", match: (node) => TYPE_VALUES.has(this.readValue(node)?.type ?? "") },
        { kind: "deps", topLevelOnly: true, match: (node) => this.bindsImport(node) },
        { kind: "decl", topLevelOnly: true },
      ],
    ],
    ["test_declaration", [{ kind: "func" }]],
    ["using_namespace_declaration", [{ kind: "deps", topLevelOnly: true }]],
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
    if (node.type === "using_namespace_declaration") {
      return readNodeText(node.namedChild(0));
    }
    return this.readNameField(node);
  }

  private readValue(node: SyntaxNode) {
    const assignIndex = node.children.findIndex((childNode) => childNode.type === "=");
    if (assignIndex < 0) return;
    return node.children.slice(assignIndex + 1).find((childNode) => childNode.isNamed);
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

  isPublicSymbol(node: SyntaxNode) {
    return node.children.some((childNode) => childNode.type === "pub");
  }
}
