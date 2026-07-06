import type Parser from "tree-sitter";
import { TYPESCRIPT_LANGUAGE_PROFILES } from "./typescript.js";
import type { LanguageProfile } from "./types.js";

const PROFILE_BY_EXTENSION = new Map<string, LanguageProfile>([...TYPESCRIPT_LANGUAGE_PROFILES]);

function matchesTopLevelRule(node: Parser.SyntaxNode, profile: LanguageProfile) {
  let current: Parser.SyntaxNode | null = node.parent;

  while (current) {
    if (profile.topLevelRoots.has(current.type)) {
      return true;
    }
    if (profile.topLevelParents.size > 0 && !profile.topLevelParents.has(current.type)) {
      return false;
    }
    current = current.parent;
  }

  return false;
}

export function readNodeName(node: Parser.SyntaxNode, profile: LanguageProfile) {
  if (node.type === "import_specifier" || node.type === "export_specifier") {
    const aliasNode = node.childForFieldName("alias");
    if (aliasNode) {
      const aliasText = aliasNode.text.trim().replaceAll("\n", " ");
      if (aliasText.length > 0) {
        return aliasText;
      }
    }
  }

  const nodeNameField = profile.nameFieldByType[node.type] ?? profile.nameFieldByType.__default__;
  const nodeName = node.childForFieldName(nodeNameField);
  if (nodeName) {
    const nodeNameText = nodeName.text.trim().replaceAll("\n", " ");
    if (nodeNameText.length > 0) {
      return nodeNameText;
    }
  }

  if (node.type === "namespace_import" || node.type === "namespace_export") {
    const namespaceNameNode = node.namedChild(0);
    if (namespaceNameNode) {
      const namespaceNameText = namespaceNameNode.text.trim().replaceAll("\n", " ");
      if (namespaceNameText.length > 0) {
        return namespaceNameText;
      }
    }
  }

  if (node.type === "identifier") {
    const identifierText = node.text.trim().replaceAll("\n", " ");
    return identifierText.length > 0 ? identifierText : undefined;
  }

  if (node.type === "arrow_function" || node.type === "function_expression") {
    const declaratorNode = node.parent?.type === "variable_declarator" ? node.parent : undefined;
    const declaratorNameNode = declaratorNode?.childForFieldName("name");
    if (declaratorNameNode) {
      const declaratorNameText = declaratorNameNode.text.trim().replaceAll("\n", " ");
      if (declaratorNameText.length > 0) {
        return declaratorNameText;
      }
    }

    return `anonymous@L${node.startPosition.row + 1}`;
  }
}

export function readContainerName(node: Parser.SyntaxNode, profile: LanguageProfile) {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (profile.typeRule.has(current.type)) {
      const containerName = readNodeName(current, profile);
      if (containerName) {
        return containerName;
      }
    }
    current = current.parent;
  }
}

export function resolveSymbolKind(node: Parser.SyntaxNode, profile: LanguageProfile) {
  const symbolKindRules = profile.typeRule.get(node.type);
  if (!symbolKindRules) return;

  for (const symbolKindRule of symbolKindRules) {
    if (
      (symbolKindRule.parent && node.parent?.type !== symbolKindRule.parent) ||
      (symbolKindRule.topLevelOnly && !matchesTopLevelRule(node, profile))
    ) {
      continue;
    }
    return symbolKindRule.kind;
  }
}

export function getLanguageProfile(extension: string) {
  return PROFILE_BY_EXTENSION.get(extension);
}

export function getSupportedExtensions() {
  return new Set(PROFILE_BY_EXTENSION.keys());
}

export { collectSymbols } from "./symbols.js";
export type { LanguageProfile, LanguageSymbol } from "./types.js";
export const SYMBOL_KINDS = [
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
  "import",
  "export",
] as const;
