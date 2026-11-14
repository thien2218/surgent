import type { SyntaxNode } from "tree-sitter";

export function readNodeText(node: SyntaxNode | null | undefined) {
  if (!node) return;
  const nodeText = node.text.trim().replaceAll("\n", " ");
  return nodeText.length > 0 ? nodeText : undefined;
}

export function readFieldText(node: SyntaxNode, fieldName: string) {
  return readNodeText(node.childForFieldName(fieldName));
}

export function findAncestor(node: SyntaxNode, type: string) {
  let current: SyntaxNode | null = node;
  while (current && current.type !== type) {
    current = current.parent;
  }
  return current ?? undefined;
}
