import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "./grammar.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "./types.js";

export class TypeScriptLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]),
      { __default__: "name" },
      new Set(["program"]),
      new Set([
        "lexical_declaration",
        "variable_declaration",
        "variable_declarator",
        "export_statement",
      ]),
      new Map<string, SymbolKindRule[]>([
        ["function_declaration", [{ kind: "function", topLevelOnly: true }]],
        ["arrow_function", [{ kind: "function", topLevelOnly: true }]],
        ["function_expression", [{ kind: "function", topLevelOnly: true }]],
        ["class_declaration", [{ kind: "class" }]],
        [
          "method_definition",
          [
            { kind: "method", parent: "class_body" },
            { kind: "method", parent: "object" },
          ],
        ],
        ["variable_declarator", [{ kind: "decl", topLevelOnly: true }]],
        ["import_specifier", [{ kind: "deps" }]],
        ["namespace_import", [{ kind: "deps" }]],
        ["identifier", [{ kind: "deps", parent: "import_clause" }]],
        ["export_statement", [{ kind: "public", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-typescript");
    const languageExports =
      typeof languagePack.default === "object" && languagePack.default !== null
        ? languagePack.default
        : languagePack;

    const typeScriptLanguage = languageExports.typescript as Language | undefined;
    if (!typeScriptLanguage) {
      throw new Error("tree-sitter-typescript missing typescript export");
    }

    if (extension === ".tsx" || extension === ".jsx") {
      return (languageExports.tsx as Language | undefined) ?? typeScriptLanguage;
    }
    return typeScriptLanguage;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "export_statement") {
      return "exports";
    }

    if (node.type === "import_specifier") {
      const aliasText = this.readFieldText(node, "alias");
      if (aliasText) {
        return aliasText;
      }
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "namespace_import") {
      return this.readNodeText(node.namedChild(0));
    }

    if (node.type === "identifier") {
      return this.readNodeText(node);
    }

    if (
      node.type === "arrow_function" ||
      node.type === "function_expression" ||
      node.type === "function_declaration"
    ) {
      const declaratorNode = node.parent?.type === "variable_declarator" ? node.parent : undefined;
      if (declaratorNode) {
        const declaratorName = this.readFieldText(declaratorNode, "name");
        if (declaratorName) {
          return declaratorName;
        }
      }

      return "anonymous";
    }
  }

  shouldSkipSymbol(node: SyntaxNode) {
    if (node.type === "export_statement") {
      const inlineNode = node.namedChild(0);
      return (
        node.childForFieldName("declaration") !== null ||
        inlineNode?.type === "arrow_function" ||
        inlineNode?.type === "function_expression" ||
        inlineNode?.type === "function_declaration" ||
        (inlineNode?.type === "class_declaration" && inlineNode.childForFieldName("name") !== null)
      );
    }
    if (node.type === "variable_declarator") {
      return node.childForFieldName("value")?.type === "arrow_function";
    }
    return node.type === "function_expression" && node.childForFieldName("name") !== null;
  }
}
