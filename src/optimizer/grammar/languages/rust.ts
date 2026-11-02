import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const RUST_KINDS = ["struct", "enum", "union", "trait", "type", "module", "macro"] as const;
type RustKind = (typeof RUST_KINDS)[number];

export class RustLanguageProfile extends RuleBasedLanguageProfile<RustKind> {
  readonly extensions = new Set([".rs"]);
  readonly extraKinds = RUST_KINDS;
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly topLevelParents = new Set([
    "declaration_list",
    "foreign_mod_item",
    "mod_item",
  ]);
  protected readonly memberParents = new Set(["declaration_list", "field_declaration_list"]);
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
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<RustKind>[]>([
    [
      "function_item",
      [
        { kind: "method", container: "impl_item" },
        { kind: "method", container: "trait_item" },
        { kind: "func" },
      ],
    ],
    ["function_signature_item", [{ kind: "method", container: "trait_item" }]],
    ["struct_item", [{ kind: "struct" }]],
    ["enum_item", [{ kind: "enum" }]],
    ["union_item", [{ kind: "union" }]],
    ["trait_item", [{ kind: "trait" }]],
    ["type_item", [{ kind: "type" }]],
    ["mod_item", [{ kind: "module" }]],
    ["macro_definition", [{ kind: "macro" }]],
    [
      "const_item",
      [
        { kind: "decl" },
        { kind: "field", container: "impl_item" },
        { kind: "field", container: "trait_item" },
      ],
    ],
    [
      "field_declaration",
      [
        { kind: "field", container: "struct_item" },
        { kind: "field", container: "union_item" },
      ],
    ],
    ["static_item", [{ kind: "decl" }]],
    ["use_declaration", [{ kind: "import" }]],
    ["extern_crate_declaration", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-rust");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "impl_item") {
      const typeNode = node.childForFieldName("type");
      const baseNode =
        typeNode?.type === "generic_type" ? typeNode.childForFieldName("type") : typeNode;
      return readNodeText(baseNode);
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (node.type === "identifier" || node.type === "type_identifier") {
      return readNodeText(node);
    }
  }

  protected findDeclarationStart(node: SyntaxNode) {
    let startNode = node;
    while (startNode.previousNamedSibling?.type === "attribute_item") {
      startNode = startNode.previousNamedSibling;
    }
    return startNode;
  }
}
