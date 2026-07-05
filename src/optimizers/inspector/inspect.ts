import { collectSymbols, type SymbolKind, type LanguageSymbol } from "../languages/index.js";
import { renderNodeWithDepth } from "./extract.js";
import type { ParsedInspectorId } from "./types.js";

const INSPECTABLE_KINDS = new Set<SymbolKind>([
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
]);

export async function inspectParsedIds(
  cwd: string,
  parsedIds: ParsedInspectorId[],
  depth: number,
  signal?: AbortSignal,
): Promise<Array<{ id: string; location: [number, number]; text: string }>> {
  const symbols: Array<{ id: string; location: [number, number]; text: string }> = [];
  const paths = new Set(parsedIds.map((id) => id.path));
  const symbolById = new Map<string, LanguageSymbol>();

  for (const path of paths) {
    if (signal?.aborted) {
      throw new Error("inspector aborted");
    }
    const symbols = await collectSymbols(cwd, path, INSPECTABLE_KINDS);
    for (const symbol of symbols) {
      symbolById.set(symbol.id, symbol);
    }
  }

  for (const id of parsedIds) {
    const entry = symbolById.get(id.orginal);
    if (!entry) continue;
    symbols.push({
      id: id.orginal,
      location: [entry.node.startPosition.row + 1, entry.node.endPosition.row + 1],
      text: renderNodeWithDepth(entry.node, depth),
    });
  }

  return symbols;
}
