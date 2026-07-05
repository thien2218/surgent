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
  const nodeNameField = profile.nameFieldByType[node.type] ?? profile.nameField;
  const nodeName = node.childForFieldName(nodeNameField);
  if (!nodeName) return;

  const nodeNameText = nodeName.text.trim().replaceAll("\n", " ");
  return nodeNameText.length > 0 ? nodeNameText : undefined;
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
export type { LanguageProfile, SymbolKind, LanguageSymbol } from "./types.js";
