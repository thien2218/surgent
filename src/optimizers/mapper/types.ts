export type MapperKind = "function" | "class" | "class_method" | "object_method";

export type MapperNeed = "location" | "container" | "signature";

export interface MapperSymbol {
  id: string;
  kind: MapperKind;
  location?: [number, number];
  container?: string;
}

export interface MapperResult {
  symbols: MapperSymbol[];
  failed: string[];
}
