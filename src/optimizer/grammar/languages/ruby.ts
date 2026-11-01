import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const RUBY_KINDS = ["class", "module"] as const;
type RubyKind = (typeof RUBY_KINDS)[number];

const REQUIRE_METHODS = new Set(["require", "require_relative", "load", "autoload"]);
const LAMBDA_METHODS = new Set(["lambda", "proc"]);
const ATTRIBUTE_METHODS = new Set(["attr_reader", "attr_writer", "attr_accessor"]);
const TYPE_FACTORIES = new Set(["Struct.new", "Class.new", "Data.define"]);
const CONSTANT_TYPES = new Set(["constant", "scope_resolution"]);
const VARIABLE_TYPES = new Set([...CONSTANT_TYPES, "identifier", "global_variable"]);
const FIELD_TYPES = new Set(["constant", "class_variable"]);
// Point = Struct.new(:x) do ... end names its methods Point.method too.
const METHOD_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class" },
  { kind: "method", container: "module" },
  { kind: "method", container: "assignment" },
  { kind: "func" },
];
const ATTRIBUTE_RULES: SymbolKindRule[] = [
  { kind: "field", container: "class", match: isAttribute },
  { kind: "field", container: "module", match: isAttribute },
  { kind: "field", container: "assignment", match: isAttribute },
];

export class RubyLanguageProfile extends RuleBasedLanguageProfile<RubyKind> {
  readonly extensions = new Set([".rb", ".rake", ".gemspec"]);
  readonly extraKinds = RUBY_KINDS;
  protected readonly nameFieldByType = { __default__: "name", assignment: "left" };
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly topLevelParents = new Set(["body_statement", "module"]);
  protected readonly memberParents = new Set([
    "body_statement",
    "singleton_class",
    "do_block",
    "block",
    "block_body",
    "call",
  ]);
  protected readonly containerTypes = new Set([
    "class",
    "module",
    "method",
    "singleton_method",
    "assignment",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<RubyKind>[]>([
    ["class", [{ kind: "class" }]],
    ["module", [{ kind: "module" }]],
    ["method", METHOD_RULES],
    ["singleton_method", METHOD_RULES],
    [
      "assignment",
      [
        { kind: "class", match: bindsType },
        { kind: "func", match: bindsLambda },
        {
          kind: "decl",
          match: (node) => VARIABLE_TYPES.has(node.childForFieldName("left")?.type ?? ""),
        },
        {
          kind: "method",
          container: "class",
          match: (node) => assignsField(node) && bindsLambda(node),
        },
        {
          kind: "field",
          container: "class",
          match: (node) => assignsField(node) && !bindsType(node),
        },
      ],
    ],
    ["call", [{ kind: "import", match: isRequire }, ...ATTRIBUTE_RULES]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-ruby");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  findBodyNodes(node: SyntaxNode) {
    if (node.type !== "assignment" || !bindsLambda(node)) return super.findBodyNodes(node);
    const valueNode = node.childForFieldName("right");
    const functionNode =
      valueNode?.type === "lambda" ? valueNode : valueNode?.childForFieldName("block");
    const body = functionNode?.childForFieldName("body");
    return body ? [body] : [];
  }

  readNodeNames(node: SyntaxNode) {
    if (node.type !== "call" || !isAttribute(node)) return super.readNodeNames(node);
    const argumentNodes = node.childForFieldName("arguments")?.namedChildren ?? [];
    return argumentNodes.flatMap((argumentNode) =>
      argumentNode.type === "simple_symbol" ? [argumentNode.text.slice(1)] : [],
    );
  }
}

function hasBlock(node: SyntaxNode) {
  return node.childForFieldName("block") !== null;
}

function bindsType(node: SyntaxNode) {
  const valueNode = node.childForFieldName("right");
  if (valueNode?.type !== "call") return false;

  const factory = `${readFieldText(valueNode, "receiver")}.${readFieldText(valueNode, "method")}`;
  return TYPE_FACTORIES.has(factory);
}

function assignsField(node: SyntaxNode) {
  return FIELD_TYPES.has(node.childForFieldName("left")?.type ?? "");
}

function bindsLambda(node: SyntaxNode) {
  const valueNode = node.childForFieldName("right");
  if (valueNode?.type === "lambda") return true;
  return (
    valueNode?.type === "call" &&
    !valueNode.childForFieldName("receiver") &&
    LAMBDA_METHODS.has(readFieldText(valueNode, "method") ?? "") &&
    hasBlock(valueNode)
  );
}

function isAttribute(node: SyntaxNode) {
  return (
    !node.childForFieldName("receiver") &&
    !hasBlock(node) &&
    ATTRIBUTE_METHODS.has(readFieldText(node, "method") ?? "")
  );
}

function isRequire(node: SyntaxNode) {
  return (
    !node.childForFieldName("receiver") &&
    REQUIRE_METHODS.has(readFieldText(node, "method") ?? "")
  );
}
