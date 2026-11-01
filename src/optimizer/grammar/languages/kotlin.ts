import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const KOTLIN_KINDS = ["class", "interface", "object", "enum", "type"] as const;
type KotlinKind = (typeof KOTLIN_KINDS)[number];

const RECEIVER_TYPES = new Set(["user_type", "nullable_type", "parenthesized_type"]);
const VARIABLE_TYPES = new Set(["variable_declaration", "multi_variable_declaration"]);
const BODY_TYPES = new Set(["block", "function_body"]);
const FUNCTION_TYPES = new Set(["lambda_literal", "anonymous_function"]);
const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_declaration" },
  { kind: "method", container: "object_declaration" },
];
const PROPERTY_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasAccessorBody }));
const LAMBDA_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: bindsFunction }));
const FIELD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, kind: "field" as const }));

export class KotlinLanguageProfile extends RuleBasedLanguageProfile<KotlinKind> {
  readonly extensions = new Set([".kt", ".kts"]);
  readonly extraKinds = KOTLIN_KINDS;
  protected readonly nameFieldByType = { __default__: "name", type_alias: "type" };
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly memberParents = new Set([
    "class_body",
    "enum_class_body",
    "companion_object",
    "primary_constructor",
    "class_parameters",
  ]);
  protected readonly containerTypes = new Set([
    "class_declaration",
    "object_declaration",
    "type_alias",
    "function_declaration",
    "secondary_constructor",
    "property_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<KotlinKind>[]>([
    [
      "class_declaration",
      [
        { kind: "interface", match: isInterface },
        { kind: "enum", match: isEnum },
        { kind: "class" },
      ],
    ],
    ["object_declaration", [{ kind: "object" }]],
    ["type_alias", [{ kind: "type" }]],
    [
      "function_declaration",
      [
        ...MEMBER_RULES,
        { kind: "method", match: (node) => Boolean(this.readReceiver(node)) },
        { kind: "func" },
      ],
    ],
    ["secondary_constructor", MEMBER_RULES],
    [
      "property_declaration",
      [
        ...PROPERTY_RULES,
        ...LAMBDA_RULES,
        ...FIELD_RULES,
        { kind: "method", match: (node) => Boolean(this.readReceiver(node)) },
        { kind: "func", match: bindsFunction },
        { kind: "decl" },
      ],
    ],
    [
      "class_parameter",
      [{ kind: "field", container: "class_declaration", match: declaresProperty }],
    ],
    ["import", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("@tree-sitter-grammars/tree-sitter-kotlin");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "secondary_constructor") return "constructor";
    if (node.type === "class_parameter") {
      return readNodeText(node.namedChildren.find((childNode) => childNode.type === "identifier"));
    }
    if (node.type === "property_declaration") {
      const variable = node.namedChildren.find((childNode) => VARIABLE_TYPES.has(childNode.type));
      return variable?.type === "variable_declaration"
        ? readNodeText(variable.namedChild(0))
        : readNodeText(variable);
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
    return readNodeText(receiver)?.replace(/[<?].*$/s, "");
  }

  readContainerName(node: SyntaxNode) {
    return super.readContainerName(node) ?? this.readReceiver(node);
  }

  findBodyNodes(node: SyntaxNode) {
    const body = node.namedChildren.find((childNode) => BODY_TYPES.has(childNode.type));
    return body ? [body] : [];
  }
}

function hasAccessorBody(node: SyntaxNode) {
  const accessors = node.namedChildren.filter(
    (childNode) => childNode.type === "getter" || childNode.type === "setter",
  );
  return accessors.some((accessor) =>
    accessor.namedChildren.some((childNode) => childNode.type === "function_body"),
  );
}

function declaresProperty(node: SyntaxNode) {
  return node.children.some((childNode) => childNode.type === "val" || childNode.type === "var");
}

function isInterface(node: SyntaxNode) {
  return node.children.some((childNode) => childNode.type === "interface");
}

function isEnum(node: SyntaxNode) {
  const modifiers = node.namedChildren.find((childNode) => childNode.type === "modifiers");
  return (modifiers?.namedChildren ?? []).some(
    (modifier) => modifier.type === "class_modifier" && modifier.text === "enum",
  );
}

function bindsFunction(node: SyntaxNode) {
  return node.namedChildren.some((childNode) => FUNCTION_TYPES.has(childNode.type));
}
