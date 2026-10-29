import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "../types.js";

const REQUIRE_METHODS = new Set(["require", "require_relative"]);
const CONSTANT_TYPES = new Set(["constant", "scope_resolution"]);
// Point = Struct.new(:x) do ... end names its methods Point.method too.
const METHOD_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class" },
  { kind: "method", container: "module" },
  { kind: "method", container: "assignment" },
  { kind: "func", topLevelOnly: true },
];

export class RubyLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".rb", ".rake", ".gemspec"]),
      { __default__: "name", assignment: "left" },
      new Set(["program"]),
      new Set(["body_statement", "class", "module"]),
      new Map<string, SymbolKindRule[]>([
        ["class", [{ kind: "class" }]],
        ["module", [{ kind: "class" }]],
        ["method", METHOD_RULES],
        ["singleton_method", METHOD_RULES],
        ["assignment", [{ kind: "decl", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-ruby");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "call") {
      const pathNode = node.childForFieldName("arguments")?.namedChild(0);
      return this.readNodeText(pathNode)?.replace(/^(["'])(.*)\1$/, "$2");
    }
    return this.readNameField(node);
  }

  resolveSymbolKind(node: SyntaxNode) {
    if (node.type === "call") {
      const isRequire =
        !node.childForFieldName("receiver") &&
        REQUIRE_METHODS.has(this.readFieldText(node, "method") ?? "");
      return isRequire && this.matchesTopLevelRule(node) ? "deps" : undefined;
    }
    if (node.type === "assignment") {
      const targetType = node.childForFieldName("left")?.type ?? "";
      if (!CONSTANT_TYPES.has(targetType)) return;
    }
    return super.resolveSymbolKind(node);
  }
}
