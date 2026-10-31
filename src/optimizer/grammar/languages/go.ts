import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { findAncestor, readFieldText, readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const GO_KINDS = ["struct", "interface", "type"] as const;
type GoKind = (typeof GO_KINDS)[number];

export class GoLanguageProfile extends RuleBasedLanguageProfile<GoKind> {
  readonly extensions = new Set([".go"]);
  readonly extraKinds = GO_KINDS;
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly topLevelParents = new Set([
    "const_declaration",
    "import_declaration",
    "import_spec_list",
    "type_declaration",
    "var_declaration",
    "var_spec_list",
  ]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "method_declaration",
    "method_elem",
    "const_spec",
    "import_spec",
    "type_alias",
    "type_spec",
    "var_spec",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<GoKind>[]>([
    ["function_declaration", [{ kind: "func", topLevelOnly: true }]],
    ["method_declaration", [{ kind: "method" }]],
    ["method_elem", [{ kind: "method", parent: "interface_type", container: "type_spec" }]],
    ["const_spec", [{ kind: "decl", topLevelOnly: true }]],
    ["import_spec", [{ kind: "deps", topLevelOnly: true }]],
    ["type_alias", [{ kind: "type", topLevelOnly: true }]],
    ["type_spec", [{ kind: "type", topLevelOnly: true }]],
    ["var_spec", [{ kind: "decl", topLevelOnly: true }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-go");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
    if (node.type === "import_spec") {
      const importName = readFieldText(node, "name");
      if (importName) {
        return importName;
      }

      const importPath = readFieldText(node, "path");
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
      return readNodeText(node);
    }
  }

  findImportNode(node: SyntaxNode) {
    return findAncestor(node, "import_declaration") ?? node;
  }

  readContainerName(node: SyntaxNode) {
    if (node.type === "method_declaration") {
      const receiverNode = node.childForFieldName("receiver");
      const receiverParameterNode = receiverNode?.namedChild(0);
      const receiverTypeNode = receiverParameterNode?.childForFieldName("type");
      const receiverType = readNodeText(receiverTypeNode);
      if (receiverType) {
        return receiverType.replace(/^\*+/, "");
      }
    }

    return super.readContainerName(node);
  }
}
