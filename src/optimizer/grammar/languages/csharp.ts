import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { nestRule, RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const CSHARP_KINDS = ["class", "struct", "interface", "record", "enum", "type"] as const;
type CSharpKind = (typeof CSHARP_KINDS)[number];

const TYPE_CONTAINERS = [
  "class_declaration",
  "struct_declaration",
  "interface_declaration",
  "record_declaration",
];
const MEMBER_RULES: SymbolKindRule[] = TYPE_CONTAINERS.map((container) => ({
  kind: "method",
  container,
}));
const METHOD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasBody }));
const PROPERTY_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasAccessorBody }));

export class CSharpLanguageProfile extends RuleBasedLanguageProfile<CSharpKind> {
  readonly extensions = new Set([".cs"]);
  readonly extraKinds = CSHARP_KINDS;
  protected readonly topLevelRoots = new Set(["compilation_unit"]);
  protected readonly topLevelParents = new Set([
    "namespace_declaration",
    "declaration_list",
    "global_statement",
  ]);
  protected readonly memberParents = new Set(["declaration_list"]);
  protected readonly containerTypes = new Set([
    "class_declaration",
    "struct_declaration",
    "interface_declaration",
    "record_declaration",
    "enum_declaration",
    "delegate_declaration",
    "method_declaration",
    "constructor_declaration",
    "destructor_declaration",
    "operator_declaration",
    "conversion_operator_declaration",
    "property_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<CSharpKind>[]>([
    ["class_declaration", nestRule({ kind: "class" }, TYPE_CONTAINERS)],
    ["struct_declaration", nestRule({ kind: "struct" }, TYPE_CONTAINERS)],
    ["interface_declaration", nestRule({ kind: "interface" }, TYPE_CONTAINERS)],
    ["record_declaration", nestRule({ kind: "record" }, TYPE_CONTAINERS)],
    ["enum_declaration", nestRule({ kind: "enum" }, TYPE_CONTAINERS)],
    ["delegate_declaration", nestRule({ kind: "type" }, TYPE_CONTAINERS)],
    ["method_declaration", METHOD_RULES],
    ["constructor_declaration", METHOD_RULES],
    ["destructor_declaration", METHOD_RULES],
    ["operator_declaration", METHOD_RULES],
    ["conversion_operator_declaration", METHOD_RULES],
    ["property_declaration", PROPERTY_RULES],
    ["indexer_declaration", PROPERTY_RULES],
    ["event_declaration", PROPERTY_RULES],
    ["local_function_statement", [{ kind: "func", match: hasBody }]],
    ["using_directive", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c-sharp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "destructor_declaration") {
      const name = this.readNameField(node);
      return name ? `~${name}` : undefined;
    }
    if (node.type === "operator_declaration") {
      const operator = readFieldText(node, "operator");
      return operator ? `operator${operator}` : undefined;
    }
    if (node.type === "indexer_declaration") {
      return "this[]";
    }
    if (node.type === "conversion_operator_declaration") {
      const type = readFieldText(node, "type");
      return type ? `operator ${type}` : undefined;
    }
    return this.readNameField(node);
  }
}

function hasBody(node: SyntaxNode) {
  return node.childForFieldName("body") !== null;
}

function hasAccessorBody(node: SyntaxNode) {
  if (node.childForFieldName("value")?.type === "arrow_expression_clause") return true;

  const accessors = node.childForFieldName("accessors")?.namedChildren ?? [];
  return accessors.some((accessor) => accessor.childForFieldName("body"));
}
