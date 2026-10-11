import type { SyntaxNode } from "tree-sitter";
import type { LanguageSymbol } from "../languages/index.js";
import { collectSymbols, SYMBOL_KINDS } from "../languages/index.js";

const BLOCK_TYPES = new Set([
  "block",
  "statement_block",
  "class_body",
  "interface_body",
  "enum_body",
  "constructor_body",
  "declaration_list",
  "switch_body",
  "switch_block",
  "expression_switch_statement",
  "type_switch_statement",
  "select_statement",
]);

function renderNode(node: SyntaxNode, depth?: number): string {
  if (depth === undefined) return node.text;

  const pendingNodes = [{ node, level: 0 }];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  while (pendingNodes.length > 0) {
    const current = pendingNodes.pop();
    if (!current) continue;

    const isBlock = BLOCK_TYPES.has(current.node.type);
    if (isBlock && current.level >= depth) {
      const opening = current.node.children.find((child) => child.type === "{");
      const closing = current.node.children.find((child) => child.type === "}");
      replacements.push({
        start: (opening?.endIndex ?? current.node.startIndex) - node.startIndex,
        end: (closing?.startIndex ?? current.node.endIndex) - node.startIndex,
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
  return text;
}

function inspectGroupedSymbols(
  path: string,
  symbolName: string,
  symbols: LanguageSymbol[],
  depth?: number,
): { path: string; symbol: string; text: string } | undefined {
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

  if (groupedNodes.length === 0) return;
  return {
    path,
    symbol: symbolName,
    text: groupedNodes.map((groupedNode) => renderNode(groupedNode, depth)).join("\n"),
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

  const inspectedGroup = inspectGroupedSymbols(path, symbolName, symbols, depth);
  if (inspectedGroup) return inspectedGroup;

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;

    return {
      path: symbol.path,
      symbol: symbol.name,
      text: renderNode(symbol.node, depth),
    };
  }
}
