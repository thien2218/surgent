import type { Language, SyntaxNode } from "tree-sitter";

export type SymbolKind = "function" | "class" | "method" | "decl" | "deps" | "public";

export interface SymbolKindRule {
  kind: SymbolKind;
  parent?: string;
  container?: string;
  topLevelOnly?: boolean;
}

export interface LanguageSymbol {
  name: string;
  path: string;
  kind: SymbolKind;
  node: SyntaxNode;
  range?: [number, number];
  public?: boolean;
}

export interface LanguageProfile {
  extensions: Set<string>;
  loadLanguage(extension: string): Promise<Language>;
  readNodeName(node: SyntaxNode): string | undefined;
  readContainerName(node: SyntaxNode): string | undefined;
  isPublicSymbol(node: SyntaxNode): boolean;
  resolveSymbolKind(node: SyntaxNode): SymbolKind | undefined;
  shouldSkipSymbol(node: SyntaxNode): boolean;
}

export interface SupportedLanguageBucket {
  bucketName: string;
  packageName: string;
  version: string;
  extensions: Set<string>;
}

export interface GrammarInstallSettings {
  allowedRepos?: string[];
  deniedRepos?: string[];
}

export abstract class RuleBasedLanguageProfile implements LanguageProfile {
  constructor(
    readonly extensions: Set<string>,
    protected readonly nameFieldByType: { __default__: string } & Record<string, string>,
    protected readonly topLevelRoots: Set<string>,
    protected readonly topLevelParents: Set<string>,
    protected readonly typeRule: Map<string, SymbolKindRule[]>,
  ) {}

  abstract loadLanguage(extension: string): Promise<Language>;

  abstract readNodeName(node: SyntaxNode): string | undefined;

  protected findContainerNode(node: SyntaxNode) {
    let current = node.parent;
    while (current) {
      if (this.typeRule.has(current.type)) {
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
      if (this.topLevelParents.size > 0 && !this.topLevelParents.has(current.type)) {
        return false;
      }
      current = current.parent;
    }

    return false;
  }

  protected readFieldText(node: SyntaxNode, fieldName: string) {
    return this.readNodeText(node.childForFieldName(fieldName));
  }

  protected readNameField(node: SyntaxNode) {
    const fieldName = this.nameFieldByType[node.type] ?? this.nameFieldByType.__default__;
    return this.readFieldText(node, fieldName);
  }

  protected readNodeText(node: SyntaxNode | null | undefined) {
    if (!node) return;

    const nodeText = node.text.trim().replaceAll("\n", " ");
    return nodeText.length > 0 ? nodeText : undefined;
  }

  readContainerName(node: SyntaxNode) {
    const containerNode = this.findContainerNode(node);
    return containerNode ? this.readNodeName(containerNode) : undefined;
  }

  isPublicSymbol(node: SyntaxNode) {
    return this.findContainerNode(node)?.type === "export_statement";
  }

  resolveSymbolKind(node: SyntaxNode) {
    const symbolKindRules = this.typeRule.get(node.type);
    if (!symbolKindRules) return;

    for (const symbolKindRule of symbolKindRules) {
      if (symbolKindRule.parent && node.parent?.type !== symbolKindRule.parent) {
        continue;
      }

      if (symbolKindRule.container) {
        const containerNode = this.findContainerNode(node);
        if (!containerNode || containerNode.type !== symbolKindRule.container) {
          continue;
        }
      }

      if (symbolKindRule.topLevelOnly && !this.matchesTopLevelRule(node)) {
        continue;
      }

      return symbolKindRule.kind;
    }
  }

  shouldSkipSymbol(_node: SyntaxNode) {
    return false;
  }
}
