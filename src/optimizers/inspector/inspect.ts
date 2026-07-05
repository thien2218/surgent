import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type Parser from "tree-sitter";
import { createCodeParser } from "../mapper/parser.js";
import { collectSymbols } from "../mapper/symbols.js";
import type { MapperKind, MapperSymbol } from "../mapper/types.js";
import { renderNodeWithDepth } from "./extract.js";
import type { ParsedInspectorId } from "./types.js";

const INSPECTABLE_KINDS = new Set<MapperKind>([
  "function",
  "class",
  "class_method",
  "object_method",
]);

async function getParserForPath(path: string, parsers: Map<string, Parser>, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }

  const extension = extname(path).toLowerCase();
  const parser = parsers.get(extension);
  if (parser) return parser;
  const createdParser = await createCodeParser(extension);
  parsers.set(extension, createdParser);
  return createdParser;
}

export async function inspectParsedIds(
  cwd: string,
  parsedIds: ParsedInspectorId[],
  depth: number,
  signal?: AbortSignal,
): Promise<Array<{ id: string; location: [number, number]; text: string }>> {
  const symbols: Array<{ id: string; location: [number, number]; text: string }> = [];
  const paths = new Set(parsedIds.map((id) => id.path));
  const parsers = new Map<string, Parser>();
  const entryById = new Map<string, MapperSymbol>();

  for (const path of paths) {
    if (signal?.aborted) {
      throw new Error("inspector aborted");
    }

    const absolutePath = resolve(cwd, path);
    let code = "";
    try {
      code = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    let parser: Parser;
    try {
      parser = await getParserForPath(path, parsers, signal);
    } catch {
      continue;
    }

    const tree = parser.parse(code);
    for (const entry of collectSymbols(tree.rootNode, path, INSPECTABLE_KINDS)) {
      entryById.set(entry.id, entry);
    }
  }

  for (const id of parsedIds) {
    const entry = entryById.get(id.orginal);
    if (!entry) continue;
    symbols.push({
      id: id.orginal,
      location: [entry.node.startPosition.row + 1, entry.node.endPosition.row + 1],
      text: renderNodeWithDepth(entry.node, depth),
    });
  }

  return symbols;
}
