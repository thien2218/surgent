import { readFile } from "node:fs/promises";
import type { SyntaxNode } from "tree-sitter";
import { getLanguageProfile } from "./index.js";
import type { LanguageSymbol, SymbolKind } from "./types.js";
import { extname, resolve } from "node:path";
import Parser from "tree-sitter";

async function createCodeParser(extension: string) {
  const languageProfile = getLanguageProfile(extension);
  if (!languageProfile) {
    throw new Error(`missing grammar for extension: ${extension}`);
  }
  const parser = new Parser();
  parser.setLanguage(await languageProfile.loadLanguage(extension));
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

// First occurrence keeps its bare name; later ones get #1, #2, ...
export function formatSymbolName(name: string, occurrence: number) {
  return occurrence > 1 ? `${name}#${occurrence - 1}` : name;
}

export async function collectSymbols(cwd: string, path: string, kinds: Set<SymbolKind>) {
  const extension = extname(path).toLowerCase();
  const profile = getLanguageProfile(extension);
  if (!profile) return [];

  const root = await getRootNode(cwd, path);
  if (!root) return [];

  const symbols: LanguageSymbol[] = [];
  const pendingNodes: SyntaxNode[] = [root];
  const symbolIdCounts = new Map<string, number>();

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
    if (!symbolKind || !kinds.has(symbolKind) || profile.shouldSkipSymbol(currentNode)) {
      continue;
    }

    const baseName = profile.readNodeName(currentNode);
    if (!baseName) continue;

    const containerName = profile.readContainerName(currentNode);
    const symbolName =
      symbolKind === "method" && containerName ? `${containerName}.${baseName}` : baseName;

    const symbolIdCount = (symbolIdCounts.get(symbolName) ?? 0) + 1;
    symbolIdCounts.set(symbolName, symbolIdCount);
    const { startPosition, endPosition } = currentNode;
    // Nodes such as C preprocessor lines end after their newline, at the next row.
    const endsAfterNewline = endPosition.column === 0 && endPosition.row > startPosition.row;

    symbols.push({
      name: formatSymbolName(symbolName, symbolIdCount),
      path,
      kind: symbolKind,
      node: currentNode,
      range: [startPosition.row + 1, endsAfterNewline ? endPosition.row : endPosition.row + 1],
      public: profile.isPublicSymbol(currentNode),
    });
  }

  return symbols;
}
