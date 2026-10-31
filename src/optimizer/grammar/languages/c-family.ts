import type { SyntaxNode, Tree } from "tree-sitter";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

export const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_specifier" },
  { kind: "method", container: "struct_specifier" },
  { kind: "method", container: "union_specifier" },
];
export const C_TOP_LEVEL_PARENTS = [
  "preproc_if",
  "preproc_ifdef",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
  "linkage_specification",
  "declaration_list",
];

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
const MEMBER_CONTAINERS = new Set(MEMBER_RULES.map((rule) => rule.container));

export abstract class CFamilyLanguageProfile<
  Kind extends string,
> extends RuleBasedLanguageProfile<Kind> {
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
        ? readFieldText(finalNode, "name")
        : readNodeText(finalNode);
    return { scope: scope || undefined, name };
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "preproc_include") {
      return readFieldText(node, "path")?.replace(/^[<"](.*)[>"]$/, "$1");
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

  protected declaresFunction(node: SyntaxNode) {
    return this.readDeclarator(node).isFunction;
  }

  protected declaresMethod(node: SyntaxNode) {
    const { nameNode, isFunction } = this.readDeclarator(node);
    return isFunction && nameNode?.type === "qualified_identifier";
  }

  protected isLonePrototype(node: SyntaxNode) {
    return this.declaresFunction(node) && !this.hasDefinition(node);
  }

  protected definesSpecifier(node: SyntaxNode) {
    if (!node.childForFieldName("body")) return false;
    return (
      node.parent?.type !== "type_definition" ||
      this.readNodeName(node.parent) !== this.readNodeName(node)
    );
  }

  protected definesMacro(node: SyntaxNode) {
    return node.childForFieldName("value") !== null;
  }

  private hasDefinition(node: SyntaxNode) {
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
    const isMethod =
      this.declaresMethod(node) || MEMBER_CONTAINERS.has(this.findContainerNode(node)?.type);
    const container = isMethod ? this.readContainerName(node) : undefined;
    return container ? `${container}.${name}` : `${name}`;
  }
}
