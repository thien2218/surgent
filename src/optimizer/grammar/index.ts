import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureGrammarCache } from "./ensure.js";
import { SHARED_KINDS, type LanguageProfile } from "./types.js";
import { TypeScriptLanguageProfile } from "./languages/typescript.js";
import { PythonLanguageProfile } from "./languages/python.js";
import { GoLanguageProfile } from "./languages/go.js";
import { JavaLanguageProfile } from "./languages/java.js";
import { RustLanguageProfile } from "./languages/rust.js";
import { CLanguageProfile } from "./languages/c.js";
import { CppLanguageProfile } from "./languages/cpp.js";
import { CSharpLanguageProfile } from "./languages/csharp.js";
import { RubyLanguageProfile } from "./languages/ruby.js";
import { KotlinLanguageProfile } from "./languages/kotlin.js";
import { ZigLanguageProfile } from "./languages/zig.js";

type ProgrammingLanguage = {
  name: string;
  packageName: string;
  version: string;
  profile: LanguageProfile;
};

const registry: ProgrammingLanguage[] = [
  {
    name: "typescript",
    packageName: "tree-sitter-typescript",
    version: "0.23.2",
    profile: new TypeScriptLanguageProfile(),
  },
  {
    name: "python",
    packageName: "tree-sitter-python",
    version: "0.25.0",
    profile: new PythonLanguageProfile(),
  },
  {
    name: "go",
    packageName: "tree-sitter-go",
    version: "0.25.0",
    profile: new GoLanguageProfile(),
  },
  {
    name: "java",
    packageName: "tree-sitter-java",
    version: "0.23.5",
    profile: new JavaLanguageProfile(),
  },
  {
    name: "rust",
    packageName: "tree-sitter-rust",
    version: "0.24.0",
    profile: new RustLanguageProfile(),
  },
  {
    name: "c",
    packageName: "tree-sitter-c",
    version: "0.24.1",
    profile: new CLanguageProfile(),
  },
  {
    name: "cpp",
    packageName: "tree-sitter-cpp",
    version: "0.23.4",
    profile: new CppLanguageProfile(),
  },
  {
    name: "csharp",
    packageName: "tree-sitter-c-sharp",
    version: "0.23.5",
    profile: new CSharpLanguageProfile(),
  },
  {
    name: "ruby",
    packageName: "tree-sitter-ruby",
    version: "0.23.1",
    profile: new RubyLanguageProfile(),
  },
  {
    name: "kotlin",
    packageName: "@tree-sitter-grammars/tree-sitter-kotlin",
    version: "1.1.0",
    profile: new KotlinLanguageProfile(),
  },
  {
    name: "zig",
    packageName: "@tree-sitter-grammars/tree-sitter-zig",
    version: "1.1.2",
    profile: new ZigLanguageProfile(),
  },
];

export function filterLanguages(items: any[]) {
  const entries = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const entry = registry.find(({ name }) => name === item);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function getLanguageByExt(extension: string): Partial<ProgrammingLanguage> {
  return registry.find(({ profile }) => profile.extensions.has(extension)) ?? {};
}

export function getAllLanguages() {
  return registry;
}

export { collectSymbols, formatSymbolName } from "./symbols.js";
export { SHARED_KINDS } from "./types.js";
export type { LanguageProfile, LanguageSymbol } from "./types.js";
export const SYMBOL_KINDS = new Set([
  ...SHARED_KINDS,
  ...registry.flatMap(({ profile }) => profile.extraKinds),
]);

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      await ensureGrammarCache(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) {
        ctx.ui.notify(`tree-sitter grammar install failed: ${message}`, "error");
      }
    }
  });
}
