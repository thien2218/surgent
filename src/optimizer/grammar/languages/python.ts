import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const PYTHON_KINDS = ["class", "type"] as const;
type PythonKind = (typeof PYTHON_KINDS)[number];

const NAME_LIST_TYPES = new Set(["pattern_list", "tuple_pattern"]);

export class PythonLanguageProfile extends RuleBasedLanguageProfile<PythonKind> {
  readonly extensions = new Set([".py"]);
  readonly extraKinds = PYTHON_KINDS;
  protected readonly nameFieldByType = {
    __default__: "name",
    assignment: "left",
    type_alias_statement: "left",
  };
  protected readonly topLevelRoots = new Set(["module"]);
  protected readonly topLevelParents = new Set([
    "decorated_definition",
    "expression_statement",
    "block",
    "if_statement",
    "elif_clause",
    "else_clause",
    "try_statement",
    "except_clause",
    "finally_clause",
  ]);
  protected readonly memberParents = new Set([
    "block",
    "decorated_definition",
    "expression_statement",
  ]);
  protected readonly groupParents = new Set(["expression_statement"]);
  protected readonly containerTypes = new Set([
    "class_definition",
    "function_definition",
    "assignment",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<PythonKind>[]>([
    ["class_definition", [{ kind: "class" }]],
    ["function_definition", [{ kind: "method", container: "class_definition" }, { kind: "func" }]],
    [
      "assignment",
      [
        { kind: "export", match: (node) => readFieldText(node, "left") === "__all__" },
        { kind: "func", match: bindsLambda },
        { kind: "decl", match: (node) => readFieldText(node, "left") !== "__all__" },
        { kind: "method", container: "class_definition", match: bindsLambda },
        { kind: "field", container: "class_definition" },
      ],
    ],
    ["type_alias_statement", [{ kind: "type" }]],
    ["import_statement", [{ kind: "import" }]],
    ["import_from_statement", [{ kind: "import" }]],
    ["future_import_statement", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-python");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "type_alias_statement") {
      return this.readNameField(node)?.replace(/\[.*$/s, "");
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "dotted_name" || node.type === "identifier") {
      return readNodeText(node);
    }
  }

  readNodeNames(node: SyntaxNode) {
    const targetNode = node.type === "assignment" ? node.childForFieldName("left") : null;
    if (!NAME_LIST_TYPES.has(targetNode?.type ?? "")) return super.readNodeNames(node);
    return (targetNode?.namedChildren ?? []).flatMap((childNode) =>
      childNode.type === "identifier" ? [childNode.text] : [],
    );
  }

  protected findDeclarationStart(node: SyntaxNode) {
    return node.parent?.type === "decorated_definition" ? node.parent : node;
  }
}

function bindsLambda(node: SyntaxNode) {
  return node.childForFieldName("right")?.type === "lambda";
}
