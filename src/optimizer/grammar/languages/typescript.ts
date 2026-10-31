import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { findAncestor, readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const TYPESCRIPT_KINDS = ["class", "interface", "type", "enum", "callback"] as const;
type TypeScriptKind = (typeof TYPESCRIPT_KINDS)[number];

export class TypeScriptLanguageProfile extends RuleBasedLanguageProfile<TypeScriptKind> {
  readonly extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]);
  readonly extraKinds = TYPESCRIPT_KINDS;
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly topLevelParents = new Set([
    "lexical_declaration",
    "variable_declaration",
    "variable_declarator",
    "export_statement",
  ]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "arrow_function",
    "function_expression",
    "abstract_class_declaration",
    "class_declaration",
    "abstract_method_signature",
    "method_definition",
    "variable_declarator",
    "import_specifier",
    "namespace_import",
    "identifier",
    "export_statement",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<TypeScriptKind>[]>([
    ["function_declaration", [{ kind: "func", topLevelOnly: true }]],
    ["arrow_function", [{ kind: "func", topLevelOnly: true }]],
    [
      "function_expression",
      [{ kind: "func", topLevelOnly: true, match: (node) => !node.childForFieldName("name") }],
    ],
    ["abstract_class_declaration", [{ kind: "class" }]],
    ["class_declaration", [{ kind: "class" }]],
    ["abstract_method_signature", [{ kind: "method", parent: "class_body" }]],
    [
      "method_definition",
      [
        { kind: "method", parent: "class_body" },
        { kind: "method", parent: "object" },
      ],
    ],
    [
      "variable_declarator",
      [
        {
          kind: "decl",
          topLevelOnly: true,
          match: (node) => node.childForFieldName("value")?.type !== "arrow_function",
        },
      ],
    ],
    ["import_specifier", [{ kind: "deps" }]],
    ["namespace_import", [{ kind: "deps" }]],
    ["identifier", [{ kind: "deps", parent: "import_clause" }]],
    [
      "export_statement",
      [{ kind: "public", topLevelOnly: true, match: (node) => !wrapsDeclaration(node) }],
    ],
  ]);

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
      const aliasText = readFieldText(node, "alias");
      if (aliasText) {
        return aliasText;
      }
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "namespace_import") {
      return readNodeText(node.namedChild(0));
    }

    if (node.type === "identifier") {
      return readNodeText(node);
    }

    if (
      node.type === "arrow_function" ||
      node.type === "function_expression" ||
      node.type === "function_declaration"
    ) {
      const declaratorNode = node.parent?.type === "variable_declarator" ? node.parent : undefined;
      if (declaratorNode) {
        const declaratorName = readFieldText(declaratorNode, "name");
        if (declaratorName) {
          return declaratorName;
        }
      }

      return "<anonymous>";
    }
  }

  isPublicSymbol(node: SyntaxNode) {
    const declarationNode = node.parent?.type === "variable_declarator" ? node.parent : node;
    return this.findContainerNode(declarationNode)?.type === "export_statement";
  }

  findImportNode(node: SyntaxNode) {
    return findAncestor(node, "import_statement") ?? node;
  }
}

function wrapsDeclaration(node: SyntaxNode) {
  const inlineNode = node.namedChild(0);
  return (
    node.childForFieldName("declaration") !== null ||
    inlineNode?.type === "arrow_function" ||
    inlineNode?.type === "function_expression" ||
    inlineNode?.type === "function_declaration" ||
    (inlineNode?.type === "class_declaration" && inlineNode.childForFieldName("name") !== null)
  );
}
