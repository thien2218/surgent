import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "../types.js";

const RECEIVER_TYPES = new Set(["user_type", "nullable_type", "parenthesized_type"]);
const VARIABLE_TYPES = new Set(["variable_declaration", "multi_variable_declaration"]);
const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_declaration" },
  { kind: "method", container: "object_declaration" },
];

export class KotlinLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".kt", ".kts"]),
      { __default__: "name", type_alias: "type" },
      new Set(["source_file"]),
      new Set<string>(),
      new Map<string, SymbolKindRule[]>([
        ["class_declaration", [{ kind: "class" }]],
        ["object_declaration", [{ kind: "class" }]],
        ["type_alias", [{ kind: "class", topLevelOnly: true }]],
        ["function_declaration", [...MEMBER_RULES, { kind: "func", topLevelOnly: true }]],
        ["secondary_constructor", MEMBER_RULES],
        ["property_declaration", [...MEMBER_RULES, { kind: "decl", topLevelOnly: true }]],
        ["import", [{ kind: "deps", topLevelOnly: true }]],
      ]),
      new Set(["block", "class_body", "enum_class_body", "lambda_literal", "when_expression"]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("@tree-sitter-grammars/tree-sitter-kotlin");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "import") {
      return this.readNodeText(node)?.replace(/^import\s+/, "");
    }
    if (node.type === "secondary_constructor") return "constructor";
    if (node.type === "property_declaration") {
      const variable = node.namedChildren.find((childNode) => VARIABLE_TYPES.has(childNode.type));
      return variable?.type === "variable_declaration"
        ? this.readNodeText(variable.namedChild(0))
        : this.readNodeText(variable);
    }
    return this.readNameField(node);
  }

  private readReceiver(node: SyntaxNode) {
    const nameNode =
      node.type === "function_declaration"
        ? node.childForFieldName("name")
        : node.namedChildren.find((childNode) => VARIABLE_TYPES.has(childNode.type));
    if (!nameNode) return;

    const receiver = node.namedChildren.find(
      (childNode) => RECEIVER_TYPES.has(childNode.type) && childNode.endIndex <= nameNode.startIndex,
    );
    return this.readNodeText(receiver)?.replace(/[<?].*$/s, "");
  }

  readContainerName(node: SyntaxNode) {
    return super.readContainerName(node) ?? this.readReceiver(node);
  }

  resolveSymbolKind(node: SyntaxNode) {
    const kind = super.resolveSymbolKind(node);
    const isExtension = (kind === "func" || kind === "decl") && this.readReceiver(node);
    return isExtension ? "method" : kind;
  }

  isPublicSymbol(node: SyntaxNode) {
    const modifiers = node.namedChildren.find((childNode) => childNode.type === "modifiers");
    return (modifiers?.namedChildren ?? []).some(
      (modifier) => modifier.type === "visibility_modifier" && modifier.text === "public",
    );
  }

  shouldSkipSymbol(node: SyntaxNode) {
    if (node.type !== "property_declaration" || super.resolveSymbolKind(node) !== "method") {
      return false;
    }
    const accessors = node.namedChildren.filter(
      (childNode) => childNode.type === "getter" || childNode.type === "setter",
    );
    return !accessors.some((accessor) =>
      accessor.namedChildren.some((childNode) => childNode.type === "function_body"),
    );
  }
}
