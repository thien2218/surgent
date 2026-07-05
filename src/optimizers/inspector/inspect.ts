import { collectSymbols, type SymbolKind } from "../languages/index.js";
import { renderNodeWithDepth } from "./extract.js";

const INSPECTABLE_KINDS = new Set<SymbolKind>([
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
]);

export async function inspectSymbol(
  cwd: string,
  path: string,
  symbolName: string,
  depth: number,
  signal?: AbortSignal,
): Promise<{ path: string; symbol: string; lines: [number, number]; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const symbols = await collectSymbols(cwd, path, INSPECTABLE_KINDS);
  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;
    return {
      path: symbol.path,
      symbol: symbol.name,
      lines: [symbol.node.startPosition.row + 1, symbol.node.endPosition.row + 1],
      text: renderNodeWithDepth(symbol.node, depth),
    };
  }
}
