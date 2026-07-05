import type { SyntaxNode } from "tree-sitter";

function isCollapsibleNode(currentNode: SyntaxNode) {
  return currentNode.namedChildCount > 0 && /block|body/.test(currentNode.type);
}

function collapseNodeText(currentNode: SyntaxNode) {
  const currentText = currentNode.text;
  if (currentNode.namedChildCount === 0) {
    return "…";
  }

  const firstNamedChild = currentNode.namedChildren[0];
  if (!firstNamedChild) {
    return "…";
  }
  const lastNamedChild = currentNode.namedChildren[currentNode.namedChildCount - 1];
  if (!lastNamedChild) {
    return "…";
  }
  const prefix = currentText.slice(0, firstNamedChild.startIndex - currentNode.startIndex);
  const suffix = currentText.slice(lastNamedChild.endIndex - currentNode.startIndex);

  if (prefix.length === 0 && suffix.length === 0) {
    return "…";
  }

  return `${prefix}…${suffix}`;
}

export function renderNodeWithDepth(currentNode: SyntaxNode, depth: number) {
  const currentText = currentNode.text;
  if (currentNode.namedChildCount === 0) {
    return currentText;
  }

  let output = "";
  let cursor = 0;

  for (const childNode of currentNode.namedChildren) {
    const childStart = childNode.startIndex - currentNode.startIndex;
    const childEnd = childNode.endIndex - currentNode.startIndex;

    output += currentText.slice(cursor, childStart);

    if (isCollapsibleNode(childNode) && depth <= 0) {
      output += collapseNodeText(childNode);
    } else if (isCollapsibleNode(childNode)) {
      output += renderNodeWithDepth(childNode, depth - 1);
    } else {
      output += renderNodeWithDepth(childNode, depth);
    }

    cursor = childEnd;
  }

  output += currentText.slice(cursor);
  return output;
}
