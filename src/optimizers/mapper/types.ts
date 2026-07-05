import type Parser from "tree-sitter";

export type MapperKind = "function" | "class" | "class_method" | "object_method";

export interface MapperSymbol {
  id: string;
  kind: MapperKind;
  location?: [number, number];
  node: Parser.SyntaxNode;
  container?: string;
}

export interface MapperResult {
  symbols: MapperSymbol[];
  failed: string[];
}
