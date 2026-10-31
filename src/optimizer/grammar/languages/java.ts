import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const JAVA_KINDS = ["class", "interface", "enum", "record"] as const;
type JavaKind = (typeof JAVA_KINDS)[number];

export class JavaLanguageProfile extends RuleBasedLanguageProfile<JavaKind> {
  readonly extensions = new Set([".java"]);
  readonly extraKinds = JAVA_KINDS;
  protected readonly nameFieldByType = { __default__: "name", exports_module_directive: "package" };
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly containerTypes = new Set([
    "annotation_type_declaration",
    "class_declaration",
    "enum_declaration",
    "interface_declaration",
    "record_declaration",
    "constructor_declaration",
    "method_declaration",
    "import_declaration",
    "exports_module_directive",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<JavaKind>[]>([
    ["annotation_type_declaration", [{ kind: "interface" }]],
    ["class_declaration", [{ kind: "class" }]],
    ["enum_declaration", [{ kind: "enum" }]],
    ["interface_declaration", [{ kind: "interface" }]],
    ["record_declaration", [{ kind: "record" }]],
    [
      "constructor_declaration",
      [
        { kind: "method", parent: "class_body" },
        { kind: "method", parent: "enum_body_declarations" },
      ],
    ],
    [
      "method_declaration",
      [
        { kind: "method", parent: "class_body" },
        { kind: "method", parent: "enum_body_declarations" },
        { kind: "method", parent: "interface_body" },
      ],
    ],
    ["import_declaration", [{ kind: "deps" }]],
    ["exports_module_directive", [{ kind: "public", parent: "module_body" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-java");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "import_declaration") {
      const importText = node.text
        .replace(/^import\s+/, "")
        .replace(/\s*;\s*$/, "")
        .trim()
        .replaceAll("\n", " ");
      return importText.length > 0 ? importText : undefined;
    }

    if (node.type === "identifier" || node.type === "scoped_identifier") {
      return readNodeText(node);
    }
  }
}
