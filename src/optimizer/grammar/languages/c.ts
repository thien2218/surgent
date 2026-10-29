import type { Language, SyntaxNode, Tree } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "../types.js";

const NAME_TYPES = new Set([
  "identifier",
  "field_identifier",
  "type_identifier",
  "operator_name",
  "destructor_name",
  "qualified_identifier",
  "template_function",
]);
const DECLARATOR_HOLDERS = new Set([
  "function_definition",
  "declaration",
  "field_declaration",
  "type_definition",
]);
const DECLARATION_TYPES = new Set(["declaration", "field_declaration"]);
const SPECIFIER_TYPES = new Set([
  "struct_specifier",
  "union_specifier",
  "enum_specifier",
  "class_specifier",
]);

export const C_TOP_LEVEL_PARENTS = [
  "preproc_if",
  "preproc_ifdef",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
  "linkage_specification",
  "declaration_list",
];

export abstract class CFamilyLanguageProfile extends RuleBasedLanguageProfile {
  private readonly definedNames = new WeakMap<Tree, Set<string>>();

  protected readDeclarator(node: SyntaxNode) {
    let isFunction = false;
    let current = node.childForFieldName("declarator");
    while (current && !NAME_TYPES.has(current.type)) {
      // A function declarator around a parenthesized one declares a function pointer.
      if (current.type === "function_declarator") isFunction = true;
      if (current.type === "parenthesized_declarator") isFunction = false;
      current = current.childForFieldName("declarator") ?? current.namedChild(0);
    }
    return { nameNode: current ?? undefined, isFunction };
  }

  protected splitName(nameNode: SyntaxNode) {
    let finalNode = nameNode;
    while (finalNode.type === "qualified_identifier") {
      const nextNode = finalNode.childForFieldName("name");
      if (!nextNode) break;
      finalNode = nextNode;
    }

    const scope = nameNode.text
      .slice(0, nameNode.text.length - finalNode.text.length)
      .replace(/\s*::\s*$/, "");
    const name =
      finalNode.type === "template_function"
        ? this.readFieldText(finalNode, "name")
        : this.readNodeText(finalNode);
    return { scope: scope || undefined, name };
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "preproc_include") {
      return this.readFieldText(node, "path")?.replace(/^[<"](.*)[>"]$/, "$1");
    }
    if (DECLARATOR_HOLDERS.has(node.type)) {
      const { nameNode } = this.readDeclarator(node);
      return nameNode ? this.splitName(nameNode).name : undefined;
    }
    return this.readNameField(node);
  }

  readContainerName(node: SyntaxNode) {
    if (DECLARATOR_HOLDERS.has(node.type)) {
      const { nameNode } = this.readDeclarator(node);
      const scope = nameNode ? this.splitName(nameNode).scope : undefined;
      if (scope) return scope;
    }
    return super.readContainerName(node);
  }

  resolveSymbolKind(node: SyntaxNode) {
    const kind = super.resolveSymbolKind(node);
    if (!kind || !DECLARATOR_HOLDERS.has(node.type) || node.type === "type_definition") {
      return kind;
    }

    const { nameNode, isFunction } = this.readDeclarator(node);
    if (isFunction && nameNode?.type === "qualified_identifier") return "method";
    if (!DECLARATION_TYPES.has(node.type)) return kind;
    if (kind === "decl") return isFunction ? "func" : kind;
    return isFunction ? kind : undefined;
  }

  shouldSkipSymbol(node: SyntaxNode) {
    if (SPECIFIER_TYPES.has(node.type)) {
      if (!node.childForFieldName("body")) return true;
      return (
        node.parent?.type === "type_definition" &&
        this.readNodeName(node.parent) === this.readNodeName(node)
      );
    }
    if (node.type === "preproc_def") return !node.childForFieldName("value");
    if (DECLARATION_TYPES.has(node.type)) return this.hasDefinition(node);
    return false;
  }

  private hasDefinition(node: SyntaxNode) {
    if (!this.readDeclarator(node).isFunction) return false;

    let names = this.definedNames.get(node.tree);
    if (!names) {
      names = new Set();
      for (const definition of node.tree.rootNode.descendantsOfType("function_definition")) {
        names.add(this.readSymbolKey(definition));
      }
      this.definedNames.set(node.tree, names);
    }
    return names.has(this.readSymbolKey(node));
  }

  private readSymbolKey(node: SyntaxNode) {
    const name = this.readNodeName(node);
    const container =
      this.resolveSymbolKind(node) === "method" ? this.readContainerName(node) : undefined;
    return container ? `${container}.${name}` : `${name}`;
  }
}

export class CLanguageProfile extends CFamilyLanguageProfile {
  constructor() {
    super(
      new Set([".c"]),
      { __default__: "name" },
      new Set(["translation_unit"]),
      new Set(C_TOP_LEVEL_PARENTS),
      new Map<string, SymbolKindRule[]>([
        ["function_definition", [{ kind: "func", topLevelOnly: true }]],
        ["declaration", [{ kind: "decl", topLevelOnly: true }]],
        ["type_definition", [{ kind: "class", topLevelOnly: true }]],
        ["struct_specifier", [{ kind: "class" }]],
        ["union_specifier", [{ kind: "class" }]],
        ["enum_specifier", [{ kind: "class" }]],
        ["preproc_function_def", [{ kind: "func", topLevelOnly: true }]],
        ["preproc_def", [{ kind: "decl", topLevelOnly: true }]],
        ["preproc_include", [{ kind: "deps", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }
}
