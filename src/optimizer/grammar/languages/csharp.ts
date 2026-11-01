import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const CSHARP_KINDS = ["class", "struct", "interface", "record", "enum", "type"] as const;
type CSharpKind = (typeof CSHARP_KINDS)[number];

const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_declaration" },
  { kind: "method", container: "struct_declaration" },
  { kind: "method", container: "interface_declaration" },
  { kind: "method", container: "record_declaration" },
];
const PROPERTY_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasAccessorBody }));
const FIELD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, kind: "field" as const }));
const FIELD_TYPES = new Set(["field_declaration", "event_field_declaration"]);

export class CSharpLanguageProfile extends RuleBasedLanguageProfile<CSharpKind> {
  readonly extensions = new Set([".cs"]);
  readonly extraKinds = CSHARP_KINDS;
  protected readonly topLevelRoots = new Set(["compilation_unit"]);
  protected readonly topLevelParents = new Set([
    "namespace_declaration",
    "declaration_list",
    "global_statement",
  ]);
  protected readonly memberParents = new Set(["declaration_list", "parameter_list"]);
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
    ["class_declaration", [{ kind: "class" }]],
    ["struct_declaration", [{ kind: "struct" }]],
    ["interface_declaration", [{ kind: "interface" }]],
    ["record_declaration", [{ kind: "record" }]],
    ["enum_declaration", [{ kind: "enum" }]],
    ["delegate_declaration", [{ kind: "type" }]],
    ["method_declaration", MEMBER_RULES],
    ["constructor_declaration", MEMBER_RULES],
    ["destructor_declaration", MEMBER_RULES],
    ["operator_declaration", MEMBER_RULES],
    ["conversion_operator_declaration", MEMBER_RULES],
    ["property_declaration", [...PROPERTY_RULES, ...FIELD_RULES]],
    ["field_declaration", FIELD_RULES],
    ["event_field_declaration", FIELD_RULES],
    ["parameter", [{ kind: "field", container: "record_declaration", parent: "parameter_list" }]],
    ["indexer_declaration", PROPERTY_RULES],
    ["event_declaration", PROPERTY_RULES],
    ["local_function_statement", [{ kind: "func" }]],
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

  readNodeNames(node: SyntaxNode) {
    if (!FIELD_TYPES.has(node.type)) return super.readNodeNames(node);
    const declaration = node.namedChildren.find(
      (childNode) => childNode.type === "variable_declaration",
    );
    return (declaration?.namedChildren ?? []).flatMap((childNode) =>
      childNode.type === "variable_declarator" ? (readFieldText(childNode, "name") ?? []) : [],
    );
  }
}

function hasAccessorBody(node: SyntaxNode) {
  if (node.childForFieldName("value")?.type === "arrow_expression_clause") return true;

  const accessors = node.childForFieldName("accessors")?.namedChildren ?? [];
  return accessors.some((accessor) => accessor.childForFieldName("body"));
}
