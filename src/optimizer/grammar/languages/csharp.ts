import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const CSHARP_KINDS = ["class", "struct", "interface", "record", "enum", "type"] as const;
type CSharpKind = (typeof CSHARP_KINDS)[number];

export class CSharpLanguageProfile extends RuleBasedLanguageProfile<CSharpKind> {
  readonly extensions = new Set([".cs"]);
  readonly extraKinds = CSHARP_KINDS;
  protected readonly topLevelRoots = new Set(["compilation_unit"]);
  protected readonly topLevelParents = new Set(["namespace_declaration", "declaration_list"]);
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
    "using_directive",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<CSharpKind>[]>([
    ["class_declaration", [{ kind: "class" }]],
    ["struct_declaration", [{ kind: "struct" }]],
    ["interface_declaration", [{ kind: "interface" }]],
    ["record_declaration", [{ kind: "record" }]],
    ["enum_declaration", [{ kind: "enum" }]],
    ["delegate_declaration", [{ kind: "type" }]],
    ["method_declaration", [{ kind: "method" }]],
    ["constructor_declaration", [{ kind: "method" }]],
    ["destructor_declaration", [{ kind: "method" }]],
    ["operator_declaration", [{ kind: "method" }]],
    ["conversion_operator_declaration", [{ kind: "method" }]],
    ["property_declaration", [{ kind: "method", match: hasAccessorBody }]],
    ["using_directive", [{ kind: "deps", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-c-sharp");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "using_directive") {
      return readNodeText(node)
        ?.replace(/^(global\s+)?using\s+/, "")
        .replace(/\s*;$/, "");
    }
    if (node.type === "destructor_declaration") {
      const name = this.readNameField(node);
      return name ? `~${name}` : undefined;
    }
    if (node.type === "operator_declaration") {
      const operator = readFieldText(node, "operator");
      return operator ? `operator${operator}` : undefined;
    }
    if (node.type === "conversion_operator_declaration") {
      const type = readFieldText(node, "type");
      return type ? `operator ${type}` : undefined;
    }
    return this.readNameField(node);
  }

  isPublicSymbol(node: SyntaxNode) {
    return node.namedChildren.some(
      (childNode) => childNode.type === "modifier" && childNode.text === "public",
    );
  }
}

function hasAccessorBody(node: SyntaxNode) {
  if (node.childForFieldName("value")?.type === "arrow_expression_clause") return true;

  const accessors = node.childForFieldName("accessors")?.namedChildren ?? [];
  return accessors.some((accessor) => accessor.childForFieldName("body"));
}
