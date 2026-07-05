import type Parser from "tree-sitter";
import type { MapperKind, MapperSymbol } from "./types.js";
import type { SyntaxNode } from "tree-sitter";

function readNodeName(node: Parser.SyntaxNode) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return undefined;
  const nameText = nameNode.text.trim().replaceAll("\n", " ");
  return nameText.length > 0 ? nameText : undefined;
}

function readContainerName(node: Parser.SyntaxNode) {
  let currentNode: Parser.SyntaxNode | null = node.parent;

  while (currentNode) {
    if (currentNode.type === "class_declaration") {
      const className = readNodeName(currentNode);
      if (className) {
        return className;
      }
    }

    if (currentNode.type === "method_definition") {
      const methodName = readNodeName(currentNode);
      if (methodName) {
        return methodName;
      }
    }

    if (currentNode.type === "function_declaration") {
      const functionName = readNodeName(currentNode);
      if (functionName) {
        return functionName;
      }
    }

    if (currentNode.type === "variable_declarator") {
      const variableNameNode = currentNode.childForFieldName("name");
      const variableName = variableNameNode?.text.trim();
      if (variableName) {
        return variableName;
      }
    }

    if (currentNode.type === "pair") {
      const keyNode = currentNode.childForFieldName("key");
      const keyName = keyNode?.text.trim().replaceAll(/^['"]|['"]$/g, "");
      if (keyName) {
        return keyName;
      }
    }

    currentNode = currentNode.parent;
  }

  return undefined;
}

function resolveSymbolKind(node: Parser.SyntaxNode): MapperKind | undefined {
  if (node.type === "function_declaration") {
    return "function";
  }
  if (node.type === "class_declaration") {
    return "class";
  }
  if (node.type === "method_definition" && node.parent?.type === "class_body") {
    return "class_method";
  }
  if (node.type === "method_definition" && node.parent?.type === "object") {
    return "object_method";
  }
  return undefined;
}

export function collectSymbols(
  root: SyntaxNode,
  path: string,
  kinds: Set<MapperKind>,
  fields?: Set<string>,
) {
  const symbols: MapperSymbol[] = [];
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

    const symbolKind = resolveSymbolKind(currentNode);
    if (!symbolKind || !kinds.has(symbolKind)) continue;

    const baseName = readNodeName(currentNode);
    if (!baseName) continue;

    const containerName = readContainerName(currentNode);
    const symbolName =
      symbolKind === "class_method" || symbolKind === "object_method"
        ? containerName
          ? `${containerName}.${baseName}`
          : baseName
        : baseName;

    const symbolIdBase = `${path}#${symbolName}`;
    const symbolIdCount = (symbolIdCounts.get(symbolIdBase) ?? 0) + 1;
    symbolIdCounts.set(symbolIdBase, symbolIdCount);
    const symbol: MapperSymbol = {
      id: symbolIdCount === 1 ? symbolIdBase : `${symbolIdBase}~${symbolIdCount}`,
      kind: symbolKind,
      node: currentNode,
    };

    if (fields?.has("container")) {
      symbol.container = containerName;
    }
    if (fields?.has("location")) {
      symbol.location = [currentNode.startPosition.row + 1, currentNode.endPosition.row + 1];
    }

    symbols.push(symbol);
  }

  return symbols;
}
