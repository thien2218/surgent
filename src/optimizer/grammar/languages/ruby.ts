import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const RUBY_KINDS = ["class", "module", "callback"] as const;
type RubyKind = (typeof RUBY_KINDS)[number];

const REQUIRE_METHODS = new Set(["require", "require_relative"]);
const CONSTANT_TYPES = new Set(["constant", "scope_resolution"]);
// Point = Struct.new(:x) do ... end names its methods Point.method too.
const METHOD_RULES: SymbolKindRule[] = [
  { kind: "method", container: "class" },
  { kind: "method", container: "module" },
  { kind: "method", container: "assignment" },
  { kind: "func", topLevelOnly: true },
];

export class RubyLanguageProfile extends RuleBasedLanguageProfile<RubyKind> {
  readonly extensions = new Set([".rb", ".rake", ".gemspec"]);
  readonly extraKinds = RUBY_KINDS;
  protected readonly nameFieldByType = { __default__: "name", assignment: "left" };
  protected readonly topLevelRoots = new Set(["program"]);
  protected readonly topLevelParents = new Set(["body_statement", "class", "module"]);
  protected readonly containerTypes = new Set([
    "class",
    "module",
    "method",
    "singleton_method",
    "assignment",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<RubyKind>[]>([
    ["class", [{ kind: "class" }]],
    ["module", [{ kind: "module" }]],
    ["method", METHOD_RULES],
    ["singleton_method", METHOD_RULES],
    [
      "assignment",
      [
        {
          kind: "decl",
          topLevelOnly: true,
          match: (node) => CONSTANT_TYPES.has(node.childForFieldName("left")?.type ?? ""),
        },
      ],
    ],
    ["call", [{ kind: "deps", topLevelOnly: true, match: isRequire }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-ruby");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "call") {
      const pathNode = node.childForFieldName("arguments")?.namedChild(0);
      return readNodeText(pathNode)?.replace(/^(["'])(.*)\1$/, "$2");
    }
    return this.readNameField(node);
  }
}

function isRequire(node: SyntaxNode) {
  return (
    !node.childForFieldName("receiver") &&
    REQUIRE_METHODS.has(readFieldText(node, "method") ?? "")
  );
}
