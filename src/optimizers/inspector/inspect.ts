import { collectSymbols, SYMBOL_KINDS } from "../languages/index.js";
import { renderNodeWithDepth } from "./extract.js";

export async function inspectSymbol(
  cwd: string,
  path: string,
  symbolName: string,
  depth: number,
  signal?: AbortSignal,
): Promise<{ path: string; symbol: string; range: [number, number]; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const kinds = new Set(SYMBOL_KINDS);
  const symbols = await collectSymbols(cwd, path, kinds);

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;
    return {
      path: symbol.path,
      symbol: symbol.name,
      range: [symbol.node.startPosition.row + 1, symbol.node.endPosition.row + 1],
      text: renderNodeWithDepth(symbol.node, depth),
    };
  }
}
