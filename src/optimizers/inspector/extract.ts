import type { SyntaxNode } from "tree-sitter";
import type { InspectorSymbol } from "./types.js";

function readSignatureText(node: SyntaxNode) {
  const full = node.text.replaceAll(/\s+/g, " ").trim();
  const bodyNode = node.childForFieldName("body");
  if (!bodyNode) return full;

  const signatureText = node.text.slice(0, bodyNode.startIndex - node.startIndex).trimEnd();
  if (signatureText.length === 0) return full;
  return signatureText;
}

function appendBodyLines(bodyNode: SyntaxNode, depth: number, tab: number, output: string[]) {
  if (bodyNode.namedChildCount === 0) return;
  // naive body expansion - handles nodes exposing nested "body" field only.
  for (const childNode of bodyNode.namedChildren) {
    const nestedBodyNode = childNode.childForFieldName("body");
    const indentation = "  ".repeat(tab);

    if (nestedBodyNode && depth > 0) {
      const nestedHeader = childNode.text
        .slice(0, nestedBodyNode.startIndex - childNode.startIndex)
        .trim();
      output.push(`${indentation}${nestedHeader.length > 0 ? nestedHeader : childNode.type}`);
      output.push(`${indentation}{`);
      appendBodyLines(nestedBodyNode, depth - 1, tab + 1, output);
      output.push(`${indentation}}`);
      continue;
    }

    const childText = childNode.text;
    output.push(`${indentation}${childText.replaceAll(/\s+/g, " ").trim()}`);
  }
}

function readBodyText(node: SyntaxNode, depth: number) {
  const bodyNode = node.childForFieldName("body");
  if (!bodyNode) return undefined;

  const lines: string[] = ["{"];
  appendBodyLines(bodyNode, depth, 1, lines);
  lines.push("}");
  return lines.join("\n");
}

export function extractInspectorSymbol(
  node: SyntaxNode,
  needs: Set<string>,
  depth: number,
): InspectorSymbol {
  const symbolDetails: InspectorSymbol = {};
  if (needs.has("location")) {
    symbolDetails.location = [node.startPosition.row + 1, node.endPosition.row + 1];
  }
  if (needs.has("signature")) {
    symbolDetails.signature = readSignatureText(node);
  }
  if (needs.has("body")) {
    symbolDetails.body = readBodyText(node, depth);
  }
  return symbolDetails;
}
