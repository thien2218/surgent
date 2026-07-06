import { readFile } from "node:fs/promises";
import type { SyntaxNode } from "tree-sitter";
import { getLanguageProfile, readContainerName, readNodeName, resolveSymbolKind } from "./index.js";
import type { LanguageSymbol } from "./index.js";
import { extname, resolve } from "node:path";
import Parser from "tree-sitter";
import type { SymbolKind } from "./types.js";

async function createCodeParser(extension: string) {
  const languageProfile = getLanguageProfile(extension);
  if (!languageProfile) {
    throw new Error(`missing grammar for extension: ${extension}`);
  }
  const parser = new Parser();
  parser.setLanguage(await languageProfile.loadLanguage());
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

  let code = "";
  try {
    code = await readFile(absolutePath, "utf8");
  } catch {
    return;
  }

  let parser: Parser;
  try {
    parser = await getParserForPath(path, parsers);
  } catch {
    return;
  }

  const tree = parser.parse(code);
  return tree.rootNode;
}

export async function collectSymbols(
  cwd: string,
  path: string,
  kinds: Set<SymbolKind>,
  container?: true,
) {
  const root = await getRootNode(cwd, path);
  const extension = extname(path).toLowerCase();
  const profile = getLanguageProfile(extension);
  if (!profile || !root) return [];

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

    const symbolKind = resolveSymbolKind(currentNode, profile);
    if (!symbolKind || !kinds.has(symbolKind)) continue;
    if (currentNode.type === "function_expression" && currentNode.childForFieldName("name")) {
      continue;
    }

    const baseName = readNodeName(currentNode, profile);
    if (!baseName) continue;

    const containerName = readContainerName(currentNode, profile);
    const symbolName =
      symbolKind === "class_method" || symbolKind === "object_method"
        ? containerName
          ? `${containerName}.${baseName}`
          : baseName
        : baseName;

    const symbolIdCount = (symbolIdCounts.get(symbolName) ?? 0) + 1;
    symbolIdCounts.set(symbolName, symbolIdCount);
    const symbol: LanguageSymbol = {
      name: symbolIdCount === 1 ? symbolName : `${symbolName}~${symbolIdCount}`,
      path,
      kind: symbolKind,
      node: currentNode,
    };

    if (container) {
      symbol.container = containerName;
    }
    symbol.range = [currentNode.startPosition.row + 1, currentNode.endPosition.row + 1];

    symbols.push(symbol);
  }

  return symbols;
}
