import { extname } from "node:path";
import type { SyntaxNode } from "tree-sitter";
import type { LanguageProfile, LanguageSymbol } from "../grammar/index.js";
import { collectSymbols, getLanguageProfile, SYMBOL_KINDS } from "../grammar/index.js";

function isOneLiner(node: SyntaxNode) {
  return node.endPosition.row === (node.parent ?? node).startPosition.row;
}

function renderNode(node: SyntaxNode, profile: LanguageProfile, depth?: number): string {
  if (depth === undefined) return node.text.trimEnd();

  const pendingNodes = [{ node, level: 0 }];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  while (pendingNodes.length > 0) {
    const current = pendingNodes.pop();
    if (!current) continue;

    const isBlock = profile.isBlockNode(current.node);
    if (isBlock && current.level >= depth && !isOneLiner(current.node)) {
      const opening = current.node.children.find((child) => child.type === "{");
      const closing = current.node.children.find((child) => child.type === "}");
      const bodyStart = current.node.firstNamedChild?.startIndex ?? current.node.startIndex;
      const bodyEnd = current.node.lastNamedChild?.endIndex ?? current.node.endIndex;
      replacements.push({
        start: (opening?.endIndex ?? bodyStart) - node.startIndex,
        end: (closing?.startIndex ?? bodyEnd) - node.startIndex,
        text: opening && closing ? " ... " : "...",
      });
      continue;
    }

    for (const child of current.node.namedChildren.slice().reverse()) {
      pendingNodes.push({ node: child, level: current.level + Number(isBlock) });
    }
  }

  let text = node.text;
  // Apply from the end so source offsets stay valid.
  for (const replacement of replacements.reverse()) {
    text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
  }
  return text.trimEnd();
}

function inspectGroupedSymbols(
  path: string,
  symbolName: string,
  symbols: LanguageSymbol[],
  profile: LanguageProfile,
  depth?: number,
): { path: string; symbol: string; text: string } | undefined {
  const groupedSymbolsMatch = /^<(imports|exports)>(?:#([1-9]\d*))?$/.exec(symbolName);
  if (!groupedSymbolsMatch) return;

  const groupedSymbolKind = groupedSymbolsMatch[1] === "imports" ? "deps" : "public";
  const requestedGroup = Number(groupedSymbolsMatch[2] ?? 0) + 1;
  const groupedNodes: SyntaxNode[] = [];
  const groupedRanges = new Set<string>();
  let symbolsCollapsed = false;
  let symbolsGroupIndex = 0;

  for (const symbol of symbols) {
    if (symbol.kind !== groupedSymbolKind) {
      symbolsCollapsed = false;
      continue;
    }
    if (!symbolsCollapsed) {
      symbolsCollapsed = true;
      symbolsGroupIndex += 1;
    }
    if (symbolsGroupIndex !== requestedGroup) continue;

    const groupedNode =
      groupedSymbolKind === "deps" ? profile.findImportNode(symbol.node) : symbol.node;

    const groupedRange = `${groupedNode.startIndex}-${groupedNode.endIndex}`;
    if (groupedRanges.has(groupedRange)) continue;

    groupedRanges.add(groupedRange);
    groupedNodes.push(groupedNode);
  }

  if (groupedNodes.length === 0) return;
  return {
    path,
    symbol: symbolName,
    text: groupedNodes.map((groupedNode) => renderNode(groupedNode, profile, depth)).join("\n"),
  };
}

export async function inspectSymbol(
  cwd: string,
  path: string,
  symbolName: string,
  depth?: number,
  signal?: AbortSignal,
): Promise<{ path: string; symbol: string; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const kinds = new Set(SYMBOL_KINDS);
  const symbols = await collectSymbols(cwd, path, kinds);
  const profile = getLanguageProfile(extname(path).toLowerCase());
  if (!profile) return;

  const inspectedGroup = inspectGroupedSymbols(path, symbolName, symbols, profile, depth);
  if (inspectedGroup) return inspectedGroup;

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;

    return {
      path: symbol.path,
      symbol: symbol.name,
      text: renderNode(symbol.node, profile, depth),
    };
  }
}
