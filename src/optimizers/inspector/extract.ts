import type { SyntaxNode } from "tree-sitter";
import type { Range } from "./types.js";

function isCollapsibleNode(currentNode: SyntaxNode) {
  return currentNode.namedChildCount > 0 && /block|body/.test(currentNode.type);
}

function collapseNodeText(currentNode: SyntaxNode): { text: string; ranges: Range[] } {
  const currentText = currentNode.text;
  if (currentNode.namedChildCount === 0) {
    return { text: "…", ranges: [] };
  }

  const firstNamedChild = currentNode.namedChildren[0];
  const lastNamedChild = currentNode.namedChildren[currentNode.namedChildCount - 1];
  if (!firstNamedChild || !lastNamedChild) {
    return { text: "…", ranges: [] };
  }

  const prefix = currentText.slice(0, firstNamedChild.startIndex - currentNode.startIndex);
  const suffix = currentText.slice(lastNamedChild.endIndex - currentNode.startIndex);
  const ranges: Range[] = [];

  if (prefix.length > 0) {
    ranges.push([
      currentNode.startPosition.row + 1,
      firstNamedChild.startPosition.row + (firstNamedChild.startPosition.column > 0 ? 1 : 0),
    ]);
  }
  if (suffix.length > 0) {
    ranges.push([
      lastNamedChild.endPosition.row + 1,
      currentNode.endPosition.row + (currentNode.endPosition.column > 0 ? 1 : 0),
    ]);
  }

  return { text: prefix.length === 0 && suffix.length === 0 ? "…" : `${prefix}…${suffix}`, ranges };
}

export function renderNodeWithDepth(
  currentNode: SyntaxNode,
  depth: number,
): { text: string; ranges: Range[] } {
  const currentText = currentNode.text;
  if (currentNode.namedChildCount === 0) {
    return {
      text: currentText,
      ranges: [
        [
          currentNode.startPosition.row + 1,
          currentNode.endPosition.row + (currentNode.endPosition.column > 0 ? 1 : 0),
        ],
      ],
    };
  }

  let text = "";
  let cursor = 0;
  let cursorRow = currentNode.startPosition.row;
  const ranges: Range[] = [];

  for (const childNode of currentNode.namedChildren) {
    const childStart = childNode.startIndex - currentNode.startIndex;
    const childEnd = childNode.endIndex - currentNode.startIndex;
    const prefix = currentText.slice(cursor, childStart);

    text += prefix;
    if (prefix.length > 0) {
      ranges.push([
        cursorRow + 1,
        childNode.startPosition.row + (childNode.startPosition.column > 0 ? 1 : 0),
      ]);
    }

    const rendered =
      isCollapsibleNode(childNode) && depth <= 0
        ? collapseNodeText(childNode)
        : renderNodeWithDepth(childNode, isCollapsibleNode(childNode) ? depth - 1 : depth);

    text += rendered.text;
    ranges.push(...rendered.ranges);
    cursor = childEnd;
    cursorRow = childNode.endPosition.row;
  }

  const suffix = currentText.slice(cursor);
  text += suffix;
  if (suffix.length > 0) {
    ranges.push([
      cursorRow + 1,
      currentNode.endPosition.row + (currentNode.endPosition.column > 0 ? 1 : 0),
    ]);
  }

  return { text, ranges };
}
