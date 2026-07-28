import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "./grammar.js";
import { RuleBasedLanguageProfile, type SymbolKindRule } from "./types.js";

export class GoLanguageProfile extends RuleBasedLanguageProfile {
  constructor() {
    super(
      new Set([".go"]),
      { __default__: "name" },
      new Set(["source_file"]),
      new Set([
        "const_declaration",
        "import_declaration",
        "import_spec_list",
        "type_declaration",
        "var_declaration",
        "var_spec_list",
      ]),
      new Map<string, SymbolKindRule[]>([
        ["function_declaration", [{ kind: "func", topLevelOnly: true }]],
        ["method_declaration", [{ kind: "method" }]],
        ["method_elem", [{ kind: "method", parent: "interface_type", container: "type_spec" }]],
        ["const_spec", [{ kind: "decl", topLevelOnly: true }]],
        ["import_spec", [{ kind: "deps", topLevelOnly: true }]],
        ["type_alias", [{ kind: "class", topLevelOnly: true }]],
        ["type_spec", [{ kind: "class", topLevelOnly: true }]],
        ["var_spec", [{ kind: "decl", topLevelOnly: true }]],
      ]),
    );
  }

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-go");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "import_spec") {
      const importName = this.readFieldText(node, "name");
      if (importName) {
        return importName;
      }

      const importPath = this.readFieldText(node, "path");
      if (importPath) {
        return importPath.replace(/^("|')(.*)\1$/, "$2");
      }
    }

    const nodeName = this.readNameField(node);
    if (nodeName) {
      return nodeName;
    }

    if (
      node.type === "field_identifier" ||
      node.type === "identifier" ||
      node.type === "package_identifier" ||
      node.type === "type_identifier"
    ) {
      return this.readNodeText(node);
    }
  }

  readContainerName(node: SyntaxNode) {
    if (node.type === "method_declaration") {
      const receiverNode = node.childForFieldName("receiver");
      const receiverParameterNode = receiverNode?.namedChild(0);
      const receiverTypeNode = receiverParameterNode?.childForFieldName("type");
      const receiverType = this.readNodeText(receiverTypeNode);
      if (receiverType) {
        return receiverType.replace(/^\*+/, "");
      }
    }

    return super.readContainerName(node);
  }
}
