import type { LanguageSymbol } from "../../grammar/types.js";

export interface Call {
  name: string;
  receiver?: string;
}

export interface Callable {
  symbol: LanguageSymbol;
  file: SourceFile;
  calls: Call[];
  bindings: Set<string>;
  unresolved: number;
  incoming: Set<Callable>;
  outgoing: Set<Callable>;
}

export interface Binding {
  file: string;
  name: string;
  submodule?: string;
}

export interface SourceFile {
  path: string;
  language: string;
  symbols: LanguageSymbol[];
  callables: Callable[];
  imports: Map<string, Binding>;
  exports: Map<string, Binding>;
}

export interface TreeInput {
  mode: "incoming" | "outgoing";
  symbol: string;
  file: string;
  maxDepth?: number;
}

export interface TreeNode {
  callable: Callable;
  parent?: TreeNode;
  children: TreeNode[];
  depth: number;
  cycle: boolean;
}
