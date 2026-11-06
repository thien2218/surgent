import type { Language, SyntaxNode } from "tree-sitter";

export const SHARED_KINDS = ["func", "method", "decl"] as const;

export type SharedKind = (typeof SHARED_KINDS)[number];
export type GroupKind = "import" | "export";

export interface SymbolKindRule<Kind extends string = never> {
  kind: SharedKind | GroupKind | Kind;
  parent?: string;
  container?: string;
  match?(node: SyntaxNode): boolean;
}

export interface LanguageSymbol {
  name: string;
  baseName: string;
  container?: string;
  path: string;
  kind: string;
  node: SyntaxNode;
  startIndex: number;
  range: [number, number];
}

export interface LanguageProfile<Kind extends string = string> {
  readonly extensions: ReadonlySet<string>;
  readonly extraKinds: readonly Kind[];
  loadLanguage(extension: string): Promise<Language>;
  resolveSymbolRule(node: SyntaxNode): SymbolKindRule<Kind> | undefined;
  isMethod(node: SyntaxNode): boolean;
  readNodeName(node: SyntaxNode): string | undefined;
  readNodeNames(node: SyntaxNode): string[];
  readContainerName(node: SyntaxNode): string | undefined;
  readScopeName(node: SyntaxNode): string | undefined;
  findBodyNodes(node: SyntaxNode): SyntaxNode[];
  findStartNode(node: SyntaxNode): SyntaxNode;
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
