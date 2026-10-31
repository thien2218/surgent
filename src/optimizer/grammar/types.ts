import type { Language, SyntaxNode } from "tree-sitter";

export const SHARED_KINDS = ["func", "method", "decl", "deps", "public"] as const;

export type SharedKind = (typeof SHARED_KINDS)[number];

export interface SymbolKindRule<Kind extends string = never> {
  kind: SharedKind | Kind;
  parent?: string;
  container?: string;
  topLevelOnly?: boolean;
  match?(node: SyntaxNode): boolean;
}

export interface LanguageSymbol {
  name: string;
  path: string;
  kind: string;
  node: SyntaxNode;
  range?: [number, number];
  public?: boolean;
}

export interface LanguageProfile<Kind extends string = string> {
  readonly extensions: ReadonlySet<string>;
  readonly extraKinds: readonly Kind[];
  loadLanguage(extension: string): Promise<Language>;
  resolveSymbolKind(node: SyntaxNode): SharedKind | Kind | undefined;
  readNodeName(node: SyntaxNode): string | undefined;
  readContainerName(node: SyntaxNode): string | undefined;
  isPublicSymbol(node: SyntaxNode): boolean;
  findImportNode(node: SyntaxNode): SyntaxNode;
  findBodyNode(node: SyntaxNode): SyntaxNode | undefined;
}

export interface SupportedLanguageBucket {
  name: string;
  packageName: string;
  version: string;
  extensions: Set<string>;
}

export interface GrammarInstallSettings {
  allowedRepos?: string[];
  deniedRepos?: string[];
}
