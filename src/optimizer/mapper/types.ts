import type { LanguageSymbol } from "../languages/types.js";

export interface MapperResult {
  symbols: LanguageSymbol[];
  failed: string[];
}
