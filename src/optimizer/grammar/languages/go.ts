import type { Language, SyntaxNode } from "tree-sitter";
import { loadGrammarModule } from "../ensure.js";
import { readNodeText } from "../nodes.js";
import { RuleBasedLanguageProfile } from "../profile.js";
import type { SymbolKindRule } from "../types.js";

const GO_KINDS = ["struct", "interface", "type"] as const;
type GoKind = (typeof GO_KINDS)[number];

const NAME_LIST_TYPES = new Set(["const_spec", "var_spec"]);

export class GoLanguageProfile extends RuleBasedLanguageProfile<GoKind> {
  readonly extensions = new Set([".go"]);
  readonly extraKinds = GO_KINDS;
  protected readonly topLevelRoots = new Set(["source_file"]);
  protected readonly topLevelParents = new Set([
    "const_declaration",
    "type_declaration",
    "var_declaration",
    "var_spec_list",
  ]);
  protected readonly containerTypes = new Set([
    "function_declaration",
    "method_declaration",
    "const_spec",
    "type_alias",
    "type_spec",
    "var_spec",
  ]);
  protected readonly rules = new Map<string, SymbolKindRule<GoKind>[]>([
    ["function_declaration", [{ kind: "func", match: hasBody }]],
    ["method_declaration", [{ kind: "method", match: hasBody }]],
    ["const_spec", [{ kind: "decl" }]],
    ["type_alias", [{ kind: "type" }]],
    [
      "type_spec",
      [
        { kind: "struct", match: (node) => hasType(node, "struct_type") },
        { kind: "interface", match: (node) => hasType(node, "interface_type") },
        { kind: "type" },
      ],
    ],
    ["var_spec", [{ kind: "func", match: bindsFunctions }, { kind: "decl" }]],
    ["import_declaration", [{ kind: "import" }]],
  ]);

  async loadLanguage(_extension: string) {
    const languagePack = await loadGrammarModule("tree-sitter-go");
    const languageExport = (languagePack.default ?? languagePack) as Language;
    return languageExport;
  }

  readNodeName(node: SyntaxNode) {
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

  readNodeNames(node: SyntaxNode) {
    if (!NAME_LIST_TYPES.has(node.type)) return super.readNodeNames(node);
    return node
      .childrenForFieldName("name")
      .filter((nameNode) => nameNode.isNamed)
      .map((nameNode) => nameNode.text);
  }

  findBodyNodes(node: SyntaxNode) {
    if (node.type !== "var_spec") return super.findBodyNodes(node);
    const values = node.childForFieldName("value")?.namedChildren ?? [];
    return values.flatMap((valueNode) =>
      valueNode.type === "func_literal" ? (valueNode.childForFieldName("body") ?? []) : [],
    );
  }

  readContainerName(node: SyntaxNode) {
    if (node.type === "method_declaration") {
      const receiverNode = node.childForFieldName("receiver");
      const receiverParameterNode = receiverNode?.namedChild(0);
      const receiverTypeNode = receiverParameterNode?.childForFieldName("type");
      const receiverType = readNodeText(receiverTypeNode);
      if (receiverType) {
        return receiverType.replace(/^\*+/, "").replace(/\[.*$/s, "");
      }
    }

    return super.readContainerName(node);
  }
}

function hasBody(node: SyntaxNode) {
  return node.childForFieldName("body") !== null;
}

function hasType(node: SyntaxNode, typeName: string) {
  return node.childForFieldName("type")?.type === typeName;
}

function bindsFunctions(node: SyntaxNode) {
  const values = node.childForFieldName("value")?.namedChildren ?? [];
  return values.length > 0 && values.every((valueNode) => valueNode.type === "func_literal");
}
