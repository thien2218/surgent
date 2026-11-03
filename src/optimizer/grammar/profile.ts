import type { Language, SyntaxNode } from "tree-sitter";
import { readFieldText } from "./nodes.js";
import type { LanguageProfile, SymbolKindRule } from "./types.js";

export function nestRule<Kind extends string>(
  rule: SymbolKindRule<Kind>,
  containers: readonly string[],
): SymbolKindRule<Kind>[] {
  return [rule, ...containers.map((container) => ({ ...rule, container }))];
}

export abstract class RuleBasedLanguageProfile<
  Kind extends string,
> implements LanguageProfile<Kind> {
  abstract readonly extensions: ReadonlySet<string>;
  abstract readonly extraKinds: readonly Kind[];
  protected abstract readonly rules: ReadonlyMap<string, readonly SymbolKindRule<Kind>[]>;
  protected abstract readonly containerTypes: ReadonlySet<string>;
  protected abstract readonly topLevelRoots: ReadonlySet<string>;
  protected readonly topLevelParents: ReadonlySet<string> = new Set();
  protected readonly memberParents: ReadonlySet<string> = new Set();
  protected readonly groupParents: ReadonlySet<string> = new Set();
  protected readonly nameFieldByType: { __default__: string } & Record<string, string> = {
    __default__: "name",
  };

  abstract loadLanguage(extension: string): Promise<Language>;

  resolveSymbolRule(node: SyntaxNode) {
    return this.rules.get(node.type)?.find((rule) => this.matchesRule(node, rule));
  }

  isMethod(node: SyntaxNode) {
    return !!this.rules
      .get(node.type)
      ?.some(
        (rule) =>
          rule.kind === "method" &&
          (!rule.parent || node.parent?.type === rule.parent) &&
          (rule.match?.(node) ?? true),
      );
  }

  readNodeName(node: SyntaxNode) {
    return this.readNameField(node);
  }

  readNodeNames(node: SyntaxNode) {
    const name = this.readNodeName(node);
    return name ? [name] : [];
  }

  readContainerName(node: SyntaxNode) {
    const containerNode = this.findContainerNode(node);
    return containerNode ? this.readNodeName(containerNode) : undefined;
  }

  readScopeName(_node: SyntaxNode): string | undefined {
    return undefined;
  }

  findBodyNodes(node: SyntaxNode) {
    const body = node.childForFieldName("body");
    return body ? [body] : [];
  }

  findStartNode(node: SyntaxNode) {
    const root = node.tree.rootNode;
    const source = root.text;
    let startNode = this.findDeclarationStart(node);

    while (true) {
      const comment = startNode.previousNamedSibling;
      if (!comment?.type.includes("comment")) break;
      // Inner documentation belongs to the enclosing scope, not the following symbol.
      if (comment.childForFieldName("inner")) break;

      const commentStart = comment.startIndex - root.startIndex;
      const lineStart = source.lastIndexOf("\n", commentStart - 1) + 1;
      if (source.slice(lineStart, commentStart).trim()) break;

      const lastRow =
        comment.endPosition.column === 0 ? comment.endPosition.row - 1 : comment.endPosition.row;
      const gap = source.slice(comment.endIndex - root.startIndex, startNode.startIndex - root.startIndex);
      if (startNode.startPosition.row - lastRow > 1 || gap.trim()) break;

      // Comments can separate decorators or attributes; retain those wrappers too.
      startNode = this.findDeclarationStart(comment);
    }

    return startNode;
  }

  protected findDeclarationStart(node: SyntaxNode) {
    return node;
  }

  protected matchesRule(node: SyntaxNode, rule: SymbolKindRule<Kind>) {
    if (rule.parent && node.parent?.type !== rule.parent) return false;
    if (!this.isPlaced(node, rule)) return false;
    return rule.match?.(node) ?? true;
  }

  private isPlaced(node: SyntaxNode, rule: SymbolKindRule<Kind>) {
    if (rule.kind === "import" || rule.kind === "export") {
      let current = node.parent;
      while (current && !this.topLevelRoots.has(current.type)) {
        if (!this.isGroupParent(current)) return false;
        current = current.parent;
      }
      return current !== null;
    }
    if (rule.container) {
      let current = node.parent;
      while (current && current.type !== rule.container && this.memberParents.has(current.type)) {
        current = current.parent;
      }
      return current?.type === rule.container && this.matchesTopLevelRule(current);
    }
    return this.matchesTopLevelRule(node);
  }

  protected findContainerNode(node: SyntaxNode) {
    let current = node.parent;
    while (current) {
      if (this.containerTypes.has(current.type)) {
        return current;
      }
      current = current.parent;
    }
  }

  protected matchesTopLevelRule(node: SyntaxNode) {
    let current = node.parent;

    while (current) {
      if (this.topLevelRoots.has(current.type)) {
        return true;
      }
      if (!this.isTopLevelParent(current)) {
        return false;
      }
      current = current.parent;
    }

    return false;
  }

  protected isTopLevelParent(node: SyntaxNode) {
    return this.topLevelParents.has(node.type);
  }

  protected isGroupParent(node: SyntaxNode) {
    return this.groupParents.has(node.type);
  }

  protected readNameField(node: SyntaxNode) {
    const fieldName = this.nameFieldByType[node.type] ?? this.nameFieldByType.__default__;
    return readFieldText(node, fieldName);
  }
}
