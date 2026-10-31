import type { Language, SyntaxNode } from "tree-sitter";
import { readFieldText } from "./nodes.js";
import type { LanguageProfile, SharedKind, SymbolKindRule } from "./types.js";

export abstract class RuleBasedLanguageProfile<Kind extends string>
  implements LanguageProfile<Kind>
{
  abstract readonly extensions: ReadonlySet<string>;
  abstract readonly extraKinds: readonly Kind[];
  protected abstract readonly rules: ReadonlyMap<string, readonly SymbolKindRule<Kind>[]>;
  protected abstract readonly containerTypes: ReadonlySet<string>;
  protected abstract readonly topLevelRoots: ReadonlySet<string>;
  protected readonly topLevelParents: ReadonlySet<string> = new Set();
  protected readonly nameFieldByType: { __default__: string } & Record<string, string> = {
    __default__: "name",
  };

  abstract loadLanguage(extension: string): Promise<Language>;

  resolveSymbolKind(node: SyntaxNode): SharedKind | Kind | undefined {
    return this.rules.get(node.type)?.find((rule) => this.matchesRule(node, rule))?.kind;
  }

  readNodeName(node: SyntaxNode) {
    return this.readNameField(node);
  }

  readContainerName(node: SyntaxNode) {
    const containerNode = this.findContainerNode(node);
    return containerNode ? this.readNodeName(containerNode) : undefined;
  }

  isPublicSymbol(_node: SyntaxNode) {
    return false;
  }

  findImportNode(node: SyntaxNode) {
    return node;
  }

  findBodyNode(node: SyntaxNode) {
    return node.childForFieldName("body") ?? undefined;
  }

  protected matchesRule(node: SyntaxNode, rule: SymbolKindRule<Kind>) {
    if (rule.parent && node.parent?.type !== rule.parent) return false;
    if (rule.container && this.findContainerNode(node)?.type !== rule.container) return false;
    if (rule.topLevelOnly && !this.matchesTopLevelRule(node)) return false;
    return rule.match?.(node) ?? true;
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
      if (!this.topLevelParents.has(current.type)) {
        return false;
      }
      current = current.parent;
    }

    return false;
  }

  protected readNameField(node: SyntaxNode) {
    const fieldName = this.nameFieldByType[node.type] ?? this.nameFieldByType.__default__;
    return readFieldText(node, fieldName);
  }
}
