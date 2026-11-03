import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { findAncestor, readFieldText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const TYPESCRIPT_KINDS = ["class", "interface", "type", "enum", "namespace"] as const;
type TypeScriptKind = (typeof TYPESCRIPT_KINDS)[number];

const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_declaration" },
  { kind: "method", container: "abstract_class_declaration" },
  { kind: "method", container: "variable_declarator" },
  { kind: "method", container: "export_statement" },
];
const PROPERTY_RULES: SymbolKindRule<TypeScriptKind>[] = [
  ...MEMBER_RULES.map((rule) => ({ ...rule, match: bindsFunction })),
  ...MEMBER_RULES.map((rule) => ({ ...rule, kind: "class" as const, match: bindsClass })),
];
const FUNCTION_RULES: SymbolKindRule[] = [
  { kind: "func", parent: "variable_declarator" },
  { kind: "func", parent: "export_statement" },
];
const FUNCTION_TYPES = new Set(["arrow_function", "function_expression", "generator_function"]);
const NAMESPACE_TYPES = new Set(["internal_module", "module", "ambient_declaration"]);
const TYPE_DECLARATIONS = ["interface_declaration", "type_alias_declaration"];
const REFERENCE_TYPES = new Set(["identifier", "member_expression"]);

export class TypeScriptLanguageProfile extends RuleBasedLanguageProfile<TypeScriptKind> {
  readonly extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]);
  readonly extraKinds = TYPESCRIPT_KINDS;
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly topLevelParents = new Set([
    "lexical_declaration",
    "variable_declaration",
    "variable_declarator",
    "export_statement",
    "ambient_declaration",
    "expression_statement",
    "internal_module",
    "module",
  ]);
  protected readonly memberParents = new Set(["class_body", "class", "object"]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "arrow_function",
    "function_expression",
    "abstract_class_declaration",
    "class_declaration",
    "method_definition",
    "variable_declarator",
    "export_statement",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<TypeScriptKind>[]>([
    ["function_declaration", [{ kind: "func" }]],
    ["generator_function_declaration", [{ kind: "func" }]],
    ["arrow_function", FUNCTION_RULES],
    ["function_expression", FUNCTION_RULES],
    ["generator_function", FUNCTION_RULES],
    ["abstract_class_declaration", [{ kind: "class" }]],
    ["class_declaration", [{ kind: "class" }]],
    [
      "class",
      [
        { kind: "class", parent: "variable_declarator" },
        { kind: "class", parent: "export_statement" },
      ],
    ],
    ["interface_declaration", [{ kind: "interface" }]],
    ["type_alias_declaration", [{ kind: "type" }]],
    ["enum_declaration", [{ kind: "enum" }]],
    ["internal_module", [{ kind: "namespace" }]],
    ["module", [{ kind: "namespace" }]],
    ["method_definition", MEMBER_RULES],
    ["public_field_definition", PROPERTY_RULES],
    ["variable_declarator", [{ kind: "decl", match: bindsValue }]],
    ["import_statement", [{ kind: "import" }]],
    ["lexical_declaration", [{ kind: "import", match: requiresModule }]],
    ["variable_declaration", [{ kind: "import", match: requiresModule }]],
    ["expression_statement", [{ kind: "import", match: (node) => isRequire(node.namedChild(0)) }]],
    [
      "export_statement",
      [
        { kind: "decl", match: exportsNewValue },
        { kind: "export", match: (node) => !wrapsDeclaration(node) },
      ],
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
      return "default";
    }
    if (node.parent?.type === "variable_declarator") {
      return readFieldText(node.parent, "name");
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }
    if (node.parent?.type === "export_statement") {
      return "default";
    }
  }

  findBodyNodes(node: SyntaxNode) {
    const functionNode =
      node.type === "public_field_definition" ? node.childForFieldName("value") : node;
    const body = functionNode?.childForFieldName("body");
    return body ? [body] : [];
  }

  protected findDeclarationStart(node: SyntaxNode) {
    if (node.type === "variable_declarator") return findDeclarationStart(node);
    if (node.parent?.type === "variable_declarator") return findDeclarationStart(node.parent);
    if (node.parent?.type === "export_statement") return node.parent;

    let startNode = node;
    while (startNode.previousNamedSibling?.type === "decorator") {
      startNode = startNode.previousNamedSibling;
    }
    return startNode;
  }

  protected matchesTopLevelRule(node: SyntaxNode) {
    if (!super.matchesTopLevelRule(node)) return false;
    if (TYPE_DECLARATIONS.includes(node.type) || !findAncestor(node, "ambient_declaration")) {
      return true;
    }
    return NAMESPACE_TYPES.has(node.type) && node.descendantsOfType(TYPE_DECLARATIONS).length > 0;
  }

  protected isTopLevelParent(node: SyntaxNode) {
    if (node.type === "statement_block") return NAMESPACE_TYPES.has(node.parent?.type ?? "");
    return super.isTopLevelParent(node);
  }
}

function findDeclarationStart(declarator: SyntaxNode) {
  const declaration = declarator.parent;
  const declarators = declaration?.namedChildren.filter(
    (childNode) => childNode.type === "variable_declarator",
  );
  if (!declaration || declarators?.length !== 1) return declarator;
  return declaration.parent?.type === "export_statement" ? declaration.parent : declaration;
}

function wrapsDeclaration(node: SyntaxNode) {
  const inlineNode = node.namedChild(0);
  return (
    node.childForFieldName("declaration") !== null ||
    FUNCTION_TYPES.has(inlineNode?.type ?? "") ||
    inlineNode?.type === "function_declaration" ||
    inlineNode?.type === "class" ||
    (inlineNode?.type === "class_declaration" && inlineNode.childForFieldName("name") !== null)
  );
}

function exportsNewValue(node: SyntaxNode) {
  const valueNode = node.childForFieldName("value");
  return valueNode !== null && !REFERENCE_TYPES.has(valueNode.type) && !wrapsDeclaration(node);
}

function bindsValue(node: SyntaxNode) {
  return !bindsFunction(node) && !bindsClass(node) && !isRequire(node.childForFieldName("value"));
}

function bindsFunction(node: SyntaxNode) {
  return FUNCTION_TYPES.has(node.childForFieldName("value")?.type ?? "");
}

function bindsClass(node: SyntaxNode) {
  return node.childForFieldName("value")?.type === "class";
}

function requiresModule(node: SyntaxNode) {
  return node.namedChildren.some(
    (childNode) =>
      childNode.type === "variable_declarator" && isRequire(childNode.childForFieldName("value")),
  );
}

function isRequire(node: SyntaxNode | null) {
  return node?.type === "call_expression" && readFieldText(node, "function") === "require";
}
