import { readFile } from "node:fs/promises";
import type { SyntaxNode } from "tree-sitter";
import { getLanguageByExt } from "./index.js";
import type { LanguageSymbol } from "./types.js";
import { extname, resolve } from "node:path";
import Parser from "tree-sitter";

const MEMBER_KINDS = new Set(["method", "field"]);
const GROUP_NAMES = new Map([
  ["import", "(imports)"],
  ["export", "(exports)"],
]);

async function createCodeParser(extension: string) {
  const { profile } = getLanguageByExt(extension);
  if (!profile) {
    throw new Error(`missing grammar for extension: ${extension}`);
  }
  const parser = new Parser();
  parser.setLanguage(await profile.loadLanguage(extension));
  return parser;
}

async function getParserForPath(path: string, parsers: Map<string, Parser>) {
  const extension = extname(path).toLowerCase();
  const parser = parsers.get(extension);
  if (parser) return parser;

  const createdParser = await createCodeParser(extension);
  parsers.set(extension, createdParser);
  return createdParser;
}

async function getRootNode(cwd: string, path: string) {
  const parsers = new Map<string, Parser>();
  const absolutePath = resolve(cwd, path);
  const code = await readFile(absolutePath, "utf8");
  const parser = await getParserForPath(path, parsers);
  const tree = parser.parse(code);
  return tree.rootNode;
}

function formatSymbolName(name: string, occurrence: number) {
  // First occurrence keeps its bare name; later ones get #1, #2, ...
  return occurrence > 1 ? `${name}#${occurrence - 1}` : name;
}

export async function collectSymbols(cwd: string, path: string, kinds?: ReadonlySet<string>) {
  const extension = extname(path).toLowerCase();
  const { profile } = getLanguageByExt(extension);
  if (!profile) return [];

  const root = await getRootNode(cwd, path);
  if (!root) return [];

  const symbols: LanguageSymbol[] = [];
  const pendingNodes: SyntaxNode[] = [root];
  const symbolIdCounts = new Map<string, number>();
  const source = root.text;
  let group: { symbol: LanguageSymbol; startNode: SyntaxNode } | undefined;

  const nameSymbol = (name: string) => {
    const symbolIdCount = (symbolIdCounts.get(name) ?? 0) + 1;
    symbolIdCounts.set(name, symbolIdCount);
    return formatSymbolName(name, symbolIdCount);
  };

  const isAdjacent = (lastNode: SyntaxNode, nextNode: SyntaxNode) => {
    let index = lastNode.endIndex;
    while (index < nextNode.startIndex) {
      if (/\s/.test(source[index - root.startIndex] ?? "")) {
        index += 1;
        continue;
      }
      const gapNode = root.namedDescendantForIndex(index);
      if (!gapNode.type.includes("comment")) return false;
      index = gapNode.endIndex;
    }
    return true;
  };

  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (!currentNode) continue;

    for (let childIndex = currentNode.namedChildCount - 1; childIndex >= 0; childIndex -= 1) {
      const namedChild = currentNode.namedChild(childIndex);
      if (namedChild) {
        pendingNodes.push(namedChild);
      }
    }

    const symbolKind = profile.resolveSymbolKind(currentNode);
    if (!symbolKind) continue;

    const groupName = GROUP_NAMES.get(symbolKind);
    if (groupName) {
      const startNode = profile.findStartNode(currentNode);
      if (group?.symbol.kind === symbolKind && isAdjacent(group.symbol.node, startNode)) {
        group.symbol.node = currentNode;
        group.symbol.range = readLineRange(group.startNode, currentNode);
        continue;
      }

      const symbol = {
        name: nameSymbol(groupName),
        baseName: groupName,
        path,
        kind: symbolKind,
        node: currentNode,
        startIndex: startNode.startIndex,
        range: readLineRange(startNode, currentNode),
      };
      symbols.push(symbol);
      group = { symbol, startNode };
      continue;
    }

    const baseNames = profile.readNodeNames(currentNode);
    if (baseNames.length === 0) continue;

    group = undefined;
    const container = MEMBER_KINDS.has(symbolKind)
      ? profile.readContainerName(currentNode)
      : undefined;
    const startNode = profile.findStartNode(currentNode);
    for (const baseName of baseNames) {
      symbols.push({
        name: nameSymbol(container ? `${container}.${baseName}` : baseName),
        baseName,
        container,
        path,
        kind: symbolKind,
        node: currentNode,
        startIndex: startNode.startIndex,
        range: readLineRange(startNode, currentNode),
      });
    }
  }

  return kinds ? symbols.filter((symbol) => kinds.has(symbol.kind)) : symbols;
}

function readLineRange(startNode: SyntaxNode, endNode: SyntaxNode): [number, number] {
  const { startPosition } = startNode;
  const { endPosition } = endNode;
  // Nodes such as C preprocessor lines end after their newline, at the next row.
  const endsAfterNewline = endPosition.column === 0 && endPosition.row > startPosition.row;
  return [startPosition.row + 1, endsAfterNewline ? endPosition.row : endPosition.row + 1];
}
