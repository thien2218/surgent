import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "../types.js";

export class CSharpLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".cs"]),
      { __default__: "name" },
      new Set(["compilation_unit"]),
      new Set(["namespace_declaration", "declaration_list"]),
      new Map<string, SymbolKindRule[]>([
        ["class_declaration", [{ kind: "class" }]],
        ["struct_declaration", [{ kind: "class" }]],
        ["interface_declaration", [{ kind: "class" }]],
        ["record_declaration", [{ kind: "class" }]],
        ["enum_declaration", [{ kind: "class" }]],
        ["delegate_declaration", [{ kind: "class" }]],
        ["method_declaration", [{ kind: "method" }]],
        ["constructor_declaration", [{ kind: "method" }]],
        ["destructor_declaration", [{ kind: "method" }]],
        ["operator_declaration", [{ kind: "method" }]],
        ["conversion_operator_declaration", [{ kind: "method" }]],
        ["property_declaration", [{ kind: "method" }]],
        ["using_directive", [{ kind: "deps", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c-sharp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "using_directive") {
      return this.readNodeText(node)
        ?.replace(/^(global\s+)?using\s+/, "")
        .replace(/\s*;$/, "");
    }
    if (node.type === "destructor_declaration") {
      const name = this.readNameField(node);
      return name ? `~${name}` : undefined;
    }
    if (node.type === "operator_declaration") {
      const operator = this.readFieldText(node, "operator");
      return operator ? `operator${operator}` : undefined;
    }
    if (node.type === "conversion_operator_declaration") {
      const type = this.readFieldText(node, "type");
      return type ? `operator ${type}` : undefined;
    }
    return this.readNameField(node);
  }

  isPublicSymbol(node: SyntaxNode) {
    return node.namedChildren.some(
      (childNode) => childNode.type === "modifier" && childNode.text === "public",
    );
  }

  shouldSkipSymbol(node: SyntaxNode) {
    if (node.type !== "property_declaration") return false;
    if (node.childForFieldName("value")?.type === "arrow_expression_clause") return false;

    const accessors = node.childForFieldName("accessors")?.namedChildren ?? [];
    return !accessors.some((accessor) => accessor.childForFieldName("body"));
  }
}
