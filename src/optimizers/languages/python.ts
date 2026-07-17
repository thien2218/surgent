import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "./grammar.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "./types.js";

export class PythonLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".py"]),
      {
        __default__: "name",
        assignment: "left",
        future_import_statement: "name",
        import_from_statement: "name",
        import_statement: "name",
      },
      new Set(["module"]),
      new Set(["decorated_definition", "expression_statement"]),
      new Map<string, SymbolKindRule[]>([
        ["class_definition", [{ kind: "class" }]],
        [
          "function_definition",
          [
            { kind: "class_method", container: "class_definition" },
            { kind: "function", topLevelOnly: true },
          ],
        ],
        ["assignment", [{ kind: "top_level_var", topLevelOnly: true }]],
        ["future_import_statement", [{ kind: "import", topLevelOnly: true }]],
        ["import_from_statement", [{ kind: "import", topLevelOnly: true }]],
        ["import_statement", [{ kind: "import", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-python");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  resolveSymbolKind(node: SyntaxNode) {
    if (
      node.type === "assignment" &&
      this.matchesTopLevelRule(node) &&
      this.readFieldText(node, "left") === "__all__"
    ) {
      return "export";
    }

    return super.resolveSymbolKind(node);
  }

  readNodeName(node: SyntaxNode) {
    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "dotted_name" || node.type === "identifier") {
      return this.readNodeText(node);
    }
  }
}
