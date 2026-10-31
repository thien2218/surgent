import { extname } from "node:path";
import type { SyntaxNode } from "tree-sitter";
import {
  collectSymbols,
  getLanguageByExt,
  type LanguageProfile,
  type LanguageSymbol,
} from "../grammar/index.js";

function findMethodBodies(node: SyntaxNode, profile: LanguageProfile) {
  const bodies: SyntaxNode[] = [];
  const pendingNodes = node.namedChildren.slice().reverse();

  while (pendingNodes.length > 0) {
    const current = pendingNodes.pop();
    if (!current) continue;

    if (profile.resolveSymbolKind(current) === "method") {
      const body = profile.findBodyNode(current);
      if (body) bodies.push(body);
      continue;
    }
    pendingNodes.push(...current.namedChildren.slice().reverse());
  }

  return bodies;
}

function readSignature(symbol: LanguageSymbol, profile: LanguageProfile) {
  const { node, kind } = symbol;
  const bodies: SyntaxNode[] = [];
  if (kind === "func" || kind === "method") {
    const body = profile.findBodyNode(node);
    if (body) bodies.push(body);
  } else {
    bodies.push(...findMethodBodies(node, profile));
  }

  const source = node.text;
  let text = "";
  let cursor = 0;
  for (const body of bodies) {
    text += source.slice(cursor, body.startIndex - node.startIndex).trimEnd();
    cursor = body.endIndex - node.startIndex;
  }
  return text + source.slice(cursor).trimEnd();
}

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
  const symbols = await collectSymbols(cwd, path);
  const { profile } = getLanguageByExt(extname(path).toLowerCase());
  if (!profile) return;

  const inspectedGroup = inspectGroupedSymbols(path, symbolName, symbols, profile);
  if (inspectedGroup) return inspectedGroup;

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;
    const text = signature ? readSignature(symbol, profile) : symbol.node.text.trimEnd();
    return { path: symbol.path, symbol: symbol.name, text };
  }
}
