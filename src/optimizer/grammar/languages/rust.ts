import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const RUST_KINDS = ["struct", "enum", "union", "trait", "type", "module", "macro"] as const;
type RustKind = (typeof RUST_KINDS)[number];

export class RustLanguageProfile extends RuleBasedLanguageProfile<RustKind> {
  readonly extensions = new Set([".rs"]);
  readonly extraKinds = RUST_KINDS;
  protected readonly nameFieldByType = { __default__: "name", use_declaration: "argument" };
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly topLevelParents = new Set([
    "declaration_list",
    "foreign_mod_item",
    "mod_item",
  ]);
  protected readonly containerTypes = new Set([
    "function_item",
    "function_signature_item",
    "struct_item",
    "enum_item",
    "union_item",
    "trait_item",
    "type_item",
    "mod_item",
    "impl_item",
    "macro_definition",
    "const_item",
    "static_item",
    "use_declaration",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<RustKind>[]>([
    [
      "function_item",
      [
        { kind: "method", container: "impl_item" },
        { kind: "method", container: "trait_item" },
        { kind: "func", topLevelOnly: true },
      ],
    ],
    [
      "function_signature_item",
      [
        { kind: "method", container: "trait_item" },
        { kind: "func", topLevelOnly: true },
      ],
    ],
    ["struct_item", [{ kind: "struct", topLevelOnly: true }]],
    ["enum_item", [{ kind: "enum", topLevelOnly: true }]],
    ["union_item", [{ kind: "union", topLevelOnly: true }]],
    ["trait_item", [{ kind: "trait", topLevelOnly: true }]],
    ["type_item", [{ kind: "type", topLevelOnly: true }]],
    ["mod_item", [{ kind: "module", topLevelOnly: true }]],
    ["macro_definition", [{ kind: "macro", topLevelOnly: true }]],
    ["const_item", [{ kind: "decl", topLevelOnly: true }]],
    ["static_item", [{ kind: "decl", topLevelOnly: true }]],
    ["use_declaration", [{ kind: "deps", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-rust");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "impl_item") {
      return readFieldText(node, "type");
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "identifier" || node.type === "type_identifier") {
      return readNodeText(node);
    }
  }

  isPublicSymbol(node: SyntaxNode) {
    return node.namedChildren.some((childNode) => childNode.type === "visibility_modifier");
  }
}
