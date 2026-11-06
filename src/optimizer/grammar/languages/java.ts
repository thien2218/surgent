import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { nestRule, RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const JAVA_KINDS = ["class", "interface", "enum", "record"] as const;
type JavaKind = (typeof JAVA_KINDS)[number];

const TYPE_CONTAINERS = [
  "class_declaration",
  "enum_declaration",
  "interface_declaration",
  "record_declaration",
  "annotation_type_declaration",
];
const MEMBER_RULES: SymbolKindRule[] = TYPE_CONTAINERS.map((container) => ({
  kind: "method",
  container,
}));
const METHOD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, match: hasBody }));

export class JavaLanguageProfile extends RuleBasedLanguageProfile<JavaKind> {
  readonly extensions = new Set([".java"]);
  readonly extraKinds = JAVA_KINDS;
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly groupParents = new Set(["module_declaration", "module_body"]);
  protected readonly memberParents = new Set([
    "class_body",
    "interface_body",
    "enum_body",
    "enum_body_declarations",
    "annotation_type_body",
  ]);
  protected readonly containerTypes = new Set([
    "annotation_type_declaration",
    "class_declaration",
    "enum_declaration",
    "interface_declaration",
    "record_declaration",
    "constructor_declaration",
    "method_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<JavaKind>[]>([
    ["annotation_type_declaration", nestRule({ kind: "interface" }, TYPE_CONTAINERS)],
    ["class_declaration", nestRule({ kind: "class" }, TYPE_CONTAINERS)],
    ["enum_declaration", nestRule({ kind: "enum" }, TYPE_CONTAINERS)],
    ["interface_declaration", nestRule({ kind: "interface" }, TYPE_CONTAINERS)],
    ["record_declaration", nestRule({ kind: "record" }, TYPE_CONTAINERS)],
    ["constructor_declaration", MEMBER_RULES],
    ["compact_constructor_declaration", MEMBER_RULES],
    ["method_declaration", METHOD_RULES],
    ["import_declaration", [{ kind: "import" }]],
    ["requires_module_directive", [{ kind: "import" }]],
    ["exports_module_directive", [{ kind: "export" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-java");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }
}

function hasBody(node: SyntaxNode) {
  return node.childForFieldName("body") !== null;
}
