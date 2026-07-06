import type { Language, SyntaxNode } from "tree-sitter";

export type SymbolKind =
  | "function"
  | "class"
  | "class_method"
  | "object_method"
  | "top_level_var"
  | "import"
  | "export";

export interface SymbolKindRule {
  kind: SymbolKind;
  parent?: string;
  topLevelOnly?: boolean;
}

export interface LanguageProfile {
  loadLanguage: () => Promise<Language>;
  nameFieldByType: { __default__: string } & Record<string, string>;
  topLevelRoots: Set<string>;
  topLevelParents: Set<string>;
  typeRule: Map<string, SymbolKindRule[]>;
}

export interface LanguageSymbol {
  name: string;
  path: string;
  kind: SymbolKind;
  node: SyntaxNode;
  range?: [number, number];
  container?: string;
}
