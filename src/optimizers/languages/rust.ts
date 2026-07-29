import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "./grammar.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "./types.js";

export class RustLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".rs"]),
      { __default__: "name", use_declaration: "argument" },
      new Set(["source_file"]),
      new Set(["declaration_list", "foreign_mod_item", "mod_item"]),
      new Map<string, SymbolKindRule[]>([
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
        ["struct_item", [{ kind: "class", topLevelOnly: true }]],
        ["enum_item", [{ kind: "class", topLevelOnly: true }]],
        ["union_item", [{ kind: "class", topLevelOnly: true }]],
        ["trait_item", [{ kind: "class", topLevelOnly: true }]],
        ["type_item", [{ kind: "class", topLevelOnly: true }]],
        ["mod_item", [{ kind: "class", topLevelOnly: true }]],
        ["impl_item", [{ kind: "class" }]],
        ["macro_definition", [{ kind: "func", topLevelOnly: true }]],
        ["const_item", [{ kind: "decl", topLevelOnly: true }]],
        ["static_item", [{ kind: "decl", topLevelOnly: true }]],
        ["use_declaration", [{ kind: "deps", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-rust");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "impl_item") {
      return this.readFieldText(node, "type");
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "identifier" || node.type === "type_identifier") {
      return this.readNodeText(node);
    }
  }

  isPublicSymbol(node: SyntaxNode) {
    return node.namedChildren.some((childNode) => childNode.type === "visibility_modifier");
  }

  shouldSkipSymbol(node: SyntaxNode) {
    return node.type === "impl_item";
  }
}
