import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "./grammar.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "./types.js";

export class JavaLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".java"]),
      { __default__: "name", exports_module_directive: "package" },
      new Set(["program"]),
      new Set<string>(),
      new Map<string, SymbolKindRule[]>([
        ["annotation_type_declaration", [{ kind: "class" }]],
        ["class_declaration", [{ kind: "class" }]],
        ["enum_declaration", [{ kind: "class" }]],
        ["interface_declaration", [{ kind: "class" }]],
        ["record_declaration", [{ kind: "class" }]],
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
        ["exports_module_directive", [{ kind: "export", parent: "module_body" }]],
      ]),
    );
  }

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
      return this.readNodeText(node);
    }
  }
}
