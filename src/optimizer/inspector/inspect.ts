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

    if (profile.isMethod(current)) {
      bodies.push(...profile.findBodyNodes(current));
      continue;
    }
    pendingNodes.push(...current.namedChildren.slice().reverse());
  }

  return bodies;
}

function readSymbolText(symbol: LanguageSymbol) {
  const root = symbol.node.tree.rootNode;
  return root.text.slice(symbol.startIndex - root.startIndex, symbol.node.endIndex - root.startIndex);
}

function readSignature(symbol: LanguageSymbol, profile: LanguageProfile) {
  const { node, kind, startIndex } = symbol;
  const bodies: SyntaxNode[] = [];
  if (kind === "func" || kind === "method") {
    bodies.push(...profile.findBodyNodes(node));
  } else {
    bodies.push(...findMethodBodies(node, profile));
  }

  const source = readSymbolText(symbol);
  let text = "";
  let cursor = 0;
  for (const body of bodies) {
    text += source
      .slice(cursor, body.startIndex - startIndex)
      .trimEnd()
      .replace(/\s*=>$/, "");
    cursor = body.endIndex - startIndex;
  }
  return text + source.slice(cursor).trimEnd();
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

  for (const symbol of symbols) {
    if (symbol.name !== symbolName) continue;
    const text = signature ? readSignature(symbol, profile) : readSymbolText(symbol).trimEnd();
    return { path: symbol.path, symbol: symbol.name, text };
  }
}
