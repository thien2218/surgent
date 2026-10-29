import { extname } from "node:path";
import type { SyntaxNode } from "tree-sitter";
import type { LanguageProfile, LanguageSymbol } from "../grammar/index.js";
import { collectSymbols, getLanguageProfile, SYMBOL_KINDS } from "../grammar/index.js";

function inspectGroupedSymbols(
  path: string,
  symbolName: string,
  symbols: LanguageSymbol[],
  profile: LanguageProfile,
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
    text: groupedNodes.map((groupedNode) => groupedNode.text.trimEnd()).join("\n"),
  };
}

export async function inspectSymbol(
  cwd: string,
  path: string,
  symbolName: string,
  signature?: boolean,
  signal?: AbortSignal,
): Promise<{ path: string; symbol: string; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const kinds = new Set(SYMBOL_KINDS);
  const symbols = await collectSymbols(cwd, path, kinds);
  const profile = getLanguageProfile(extname(path).toLowerCase());
  if (!profile) return;

  const inspectedGroup = inspectGroupedSymbols(path, symbolName, symbols, profile);
  if (inspectedGroup) return inspectedGroup;

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;
    const { node } = symbol;
    const body = signature ? profile.findBodyNode(node) : undefined;
    const text = body
      ? node.text.slice(0, body.startIndex - node.startIndex).trimEnd()
      : node.text.trimEnd();
    return { path: symbol.path, symbol: symbol.name, text };
  }
}
