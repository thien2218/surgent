import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const JAVA_KINDS = ["class", "interface", "enum", "record"] as const;
type JavaKind = (typeof JAVA_KINDS)[number];

const MEMBER_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class_declaration" },
  { kind: "method", container: "enum_declaration" },
  { kind: "method", container: "interface_declaration" },
  { kind: "method", container: "record_declaration" },
];
const FIELD_RULES = MEMBER_RULES.map((rule) => ({ ...rule, kind: "field" as const }));
const FIELD_TYPES = new Set(["field_declaration", "constant_declaration"]);

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
    "formal_parameters",
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
    ["annotation_type_declaration", [{ kind: "interface" }]],
    ["class_declaration", [{ kind: "class" }]],
    ["enum_declaration", [{ kind: "enum" }]],
    ["interface_declaration", [{ kind: "interface" }]],
    ["record_declaration", [{ kind: "record" }]],
    ["constructor_declaration", MEMBER_RULES],
    ["compact_constructor_declaration", MEMBER_RULES],
    ["method_declaration", MEMBER_RULES],
    ["field_declaration", FIELD_RULES],
    ["constant_declaration", FIELD_RULES],
    [
      "formal_parameter",
      [{ kind: "field", container: "record_declaration", parent: "formal_parameters" }],
    ],
    [
      "annotation_type_element_declaration",
      [{ kind: "method", container: "annotation_type_declaration" }],
    ],
    ["import_declaration", [{ kind: "import" }]],
    ["requires_module_directive", [{ kind: "import" }]],
    ["exports_module_directive", [{ kind: "export" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-java");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeNames(node: SyntaxNode) {
    if (!FIELD_TYPES.has(node.type)) return super.readNodeNames(node);
    return node
      .childrenForFieldName("declarator")
      .flatMap((declarator) => readFieldText(declarator, "name") ?? []);
  }
}
