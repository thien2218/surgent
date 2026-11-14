import type { SyntaxNode } from "tree-sitter";
import { readFieldText, readNodeText } from "../nodes.js";
import { nestRule, RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

export const TYPE_CONTAINERS = ["class_specifier", "struct_specifier", "union_specifier"];
export const MEMBER_RULES: SymbolKindRule[] = TYPE_CONTAINERS.map((container) => ({
  kind: "method",
  container,
}));
export const C_MEMBER_PARENTS = [
  "field_declaration_list",
  "field_declaration",
  "preproc_if",
  "preproc_ifdef",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
];
export const C_TOP_LEVEL_PARENTS = [
  "preproc_if",
  "preproc_ifdef",
  "preproc_else",
  "preproc_elif",
  "preproc_elifdef",
  "linkage_specification",
  "declaration_list",
  "declaration",
  "type_definition",
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

export abstract class CFamilyLanguageProfile<
  Kind extends string,
> extends RuleBasedLanguageProfile<Kind> {
  protected readDeclarator(node: SyntaxNode) {
    return this.walkDeclarator(node.childForFieldName("declarator"));
  }

  private walkDeclarator(declarator: SyntaxNode | null) {
    let isFunction = false;
    let current = declarator;
    while (current && !NAME_TYPES.has(current.type)) {
      // A function declarator around a parenthesized one declares a function pointer.
      if (current.type === "function_declarator") isFunction = true;
      if (current.type === "parenthesized_declarator") isFunction = false;
      current = current.childForFieldName("declarator") ?? current.namedChild(0);
    }
    return { nameNode: current ?? undefined, isFunction };
  }

  protected splitName(nameNode: SyntaxNode) {
    const scopes: string[] = [];
    let finalNode = nameNode;
    while (finalNode.type === "qualified_identifier") {
      const nextNode = finalNode.childForFieldName("name");
      if (!nextNode) break;
      const scope = readBaseName(finalNode.childForFieldName("scope"));
      if (scope) scopes.push(scope);
      finalNode = nextNode;
    }
    return { scopes, name: readBaseName(finalNode) };
  }

  readNodeName(node: SyntaxNode) {
    if (DECLARATOR_HOLDERS.has(node.type)) {
      return this.readNodeNames(node)[0];
    }
    const nameNode = node.childForFieldName("name");
    if (nameNode?.type === "qualified_identifier") {
      return this.splitName(nameNode).name;
    }
    return this.readNameField(node);
  }

  readNodeNames(node: SyntaxNode) {
    if (!DECLARATOR_HOLDERS.has(node.type)) return super.readNodeNames(node);
    return node.childrenForFieldName("declarator").flatMap((declarator) => {
      const { nameNode } = this.walkDeclarator(declarator);
      const name = nameNode ? this.splitName(nameNode).name : undefined;
      return name ?? [];
    });
  }

  readContainerName(node: SyntaxNode) {
    if (DECLARATOR_HOLDERS.has(node.type)) {
      const { nameNode } = this.readDeclarator(node);
      const owner = nameNode ? this.splitName(nameNode).scopes.at(-1) : undefined;
      if (owner) return owner;
    }
    const containerName = super.readContainerName(node);
    if (containerName) return containerName;

    const typedefNode = this.findContainerNode(node)?.parent;
    return typedefNode?.type === "type_definition" ? this.readNodeName(typedefNode) : undefined;
  }

  readScopeName(node: SyntaxNode) {
    const nameNode = node.childForFieldName("name");
    return nameNode?.type === "qualified_identifier"
      ? this.splitName(nameNode).scopes.at(-1)
      : undefined;
  }

  protected declaresFunction(node: SyntaxNode) {
    return this.readDeclarator(node).isFunction;
  }

  protected declaresMethod(node: SyntaxNode) {
    const { nameNode, isFunction } = this.readDeclarator(node);
    return isFunction && nameNode?.type === "qualified_identifier";
  }

  protected declaresVariable(node: SyntaxNode) {
    const isExtern = node.children.some(
      (childNode) => childNode.type === "storage_class_specifier" && childNode.text === "extern",
    );
    return !isExtern && !this.declaresFunction(node);
  }

  protected definesSpecifier(node: SyntaxNode) {
    if (!node.childForFieldName("body")) return false;
    return (
      node.parent?.type !== "type_definition" ||
      !this.readNodeNames(node.parent).includes(this.readNodeName(node) ?? "")
    );
  }

  protected nestSpecifier(kind: Kind) {
    return nestRule<Kind>({ kind, match: (node) => this.definesSpecifier(node) }, TYPE_CONTAINERS);
  }

  protected definesMacro(node: SyntaxNode) {
    return node.childForFieldName("value") !== null;
  }

  protected isGroupParent(node: SyntaxNode) {
    return isIncludeGuard(node) || super.isGroupParent(node);
  }
}

function isIncludeGuard(node: SyntaxNode) {
  if (node.type !== "preproc_ifdef" || node.child(0)?.type !== "#ifndef") return false;
  const definition = node.namedChildren
    .slice(1)
    .find((childNode) => childNode.type !== "comment");
  return (
    definition?.type === "preproc_def" &&
    readFieldText(definition, "name") === readFieldText(node, "name")
  );
}

function readBaseName(node: SyntaxNode | null) {
  const isTemplate = node?.type === "template_type" || node?.type === "template_function";
  return isTemplate ? readFieldText(node, "name") : readNodeText(node);
}
