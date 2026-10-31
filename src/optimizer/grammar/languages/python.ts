import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const PYTHON_KINDS = ["class"] as const;
type PythonKind = (typeof PYTHON_KINDS)[number];

export class PythonLanguageProfile extends RuleBasedLanguageProfile<PythonKind> {
  readonly extensions = new Set([".py"]);
  readonly extraKinds = PYTHON_KINDS;
  protected readonly nameFieldByType = {
    __default__: "name",
    assignment: "left",
    future_import_statement: "name",
    import_from_statement: "name",
    import_statement: "name",
  };
  protected readonly topLevelRoots = new Set(["module"]);
  protected readonly topLevelParents = new Set(["decorated_definition", "expression_statement"]);
  protected readonly containerTypes = new Set([
    "class_definition",
    "function_definition",
    "assignment",
    "future_import_statement",
    "import_from_statement",
    "import_statement",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<PythonKind>[]>([
    ["class_definition", [{ kind: "class" }]],
    [
      "function_definition",
      [
        { kind: "method", container: "class_definition" },
        { kind: "func", topLevelOnly: true },
      ],
    ],
    [
      "assignment",
      [
        {
          kind: "public",
          topLevelOnly: true,
          match: (node) => readFieldText(node, "left") === "__all__",
        },
        { kind: "decl", topLevelOnly: true },
      ],
    ],
    ["future_import_statement", [{ kind: "deps", topLevelOnly: true }]],
    ["import_from_statement", [{ kind: "deps", topLevelOnly: true }]],
    ["import_statement", [{ kind: "deps", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-python");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "dotted_name" || node.type === "identifier") {
      return readNodeText(node);
    }
  }
}
