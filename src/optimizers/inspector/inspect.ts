import { collectSymbols, type SymbolKind } from "../languages/index.js";
import { renderNodeWithDepth } from "./extract.js";
import type { ParsedInspectorId } from "./types.js";

const INSPECTABLE_KINDS = new Set<SymbolKind>([
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
]);

export async function inspectParsedId(
  cwd: string,
  parsedId: ParsedInspectorId,
  depth: number,
  signal?: AbortSignal,
): Promise<{ id: string; lines: [number, number]; text: string } | undefined> {
  if (signal?.aborted) {
    throw new Error("inspector aborted");
  }
  const symbols = await collectSymbols(cwd, parsedId.path, INSPECTABLE_KINDS);
  for (const symbol of symbols) {
    if (symbol.id !== parsedId.orginal) continue;
    return {
      id: parsedId.orginal,
      lines: [symbol.node.startPosition.row + 1, symbol.node.endPosition.row + 1],
      text: renderNodeWithDepth(symbol.node, depth),
    };
  }
}
