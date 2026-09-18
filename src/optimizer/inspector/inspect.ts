import type { SyntaxNode } from "tree-sitter";
import type { LanguageSymbol } from "../languages/index.js";
import { collectSymbols, SYMBOL_KINDS } from "../languages/index.js";
import type { Range } from "./types.js";

function inspectGroupedSymbols(
  path: string,
  symbolName: string,
  symbols: LanguageSymbol[],
): { path: string; symbol: string; range: Range; text: string } | undefined {
  const groupedSymbolsMatch = /^(imports|exports)~([1-9]\d*)$/.exec(symbolName);
  if (!groupedSymbolsMatch) return;

  const groupedSymbolKind = groupedSymbolsMatch[1] === "imports" ? "deps" : "public";
  const requestedGroup = Number(groupedSymbolsMatch[2]);
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

    let groupedNode = symbol.node;
    if (groupedSymbolKind === "deps") {
      while (groupedNode.parent?.parent) {
        groupedNode = groupedNode.parent;
      }
    }

    const groupedRange = `${groupedNode.startIndex}-${groupedNode.endIndex}`;
    if (groupedRanges.has(groupedRange)) continue;

    groupedRanges.add(groupedRange);
    groupedNodes.push(groupedNode);
  }

  const firstNode = groupedNodes[0];
  const lastNode = groupedNodes[groupedNodes.length - 1];
  if (!firstNode || !lastNode) return;
  return {
    path,
    symbol: symbolName,
    text: groupedNodes.map((groupedNode) => groupedNode.text).join("\n"),
    range: [
      firstNode.startPosition.row + 1,
      lastNode.endPosition.row + (lastNode.endPosition.column > 0 ? 1 : 0),
    ],
  };
}

export async function inspectSymbol(
  cwd: string,
  path: string,
  symbolName: string,
  signal?: AbortSignal,
): Promise<{ path: string; symbol: string; range: Range; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const kinds = new Set(SYMBOL_KINDS);
  const symbols = await collectSymbols(cwd, path, kinds);

  const inspectedGroup = inspectGroupedSymbols(path, symbolName, symbols);
  if (inspectedGroup) return inspectedGroup;

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;

    return {
      path: symbol.path,
      symbol: symbol.name,
      range: [
        symbol.node.startPosition.row + 1,
        symbol.node.endPosition.row + (symbol.node.endPosition.column > 0 ? 1 : 0),
      ],
      text: symbol.node.text,
    };
  }
}
