import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureGrammarCache } from "./ensure.js";
import type { LanguageProfile } from "./types.js";
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

export const LANGUAGE_REGISTRY: Array<{
  bucketName: string;
  packageName: string;
  version: string;
  profile: LanguageProfile;
}> = [
  {
    bucketName: "typescript",
    packageName: "tree-sitter-typescript",
    version: "0.23.2",
    profile: new TypeScriptLanguageProfile(),
  },
  {
    bucketName: "python",
    packageName: "tree-sitter-python",
    version: "0.25.0",
    profile: new PythonLanguageProfile(),
  },
  {
    bucketName: "go",
    packageName: "tree-sitter-go",
    version: "0.25.0",
    profile: new GoLanguageProfile(),
  },
  {
    bucketName: "java",
    packageName: "tree-sitter-java",
    version: "0.23.5",
    profile: new JavaLanguageProfile(),
  },
  {
    bucketName: "rust",
    packageName: "tree-sitter-rust",
    version: "0.24.0",
    profile: new RustLanguageProfile(),
  },
  {
    bucketName: "c",
    packageName: "tree-sitter-c",
    version: "0.24.1",
    profile: new CLanguageProfile(),
  },
  {
    bucketName: "cpp",
    packageName: "tree-sitter-cpp",
    version: "0.23.4",
    profile: new CppLanguageProfile(),
  },
  {
    bucketName: "csharp",
    packageName: "tree-sitter-c-sharp",
    version: "0.23.5",
    profile: new CSharpLanguageProfile(),
  },
  {
    bucketName: "ruby",
    packageName: "tree-sitter-ruby",
    version: "0.23.1",
    profile: new RubyLanguageProfile(),
  },
  {
    bucketName: "kotlin",
    packageName: "@tree-sitter-grammars/tree-sitter-kotlin",
    version: "1.1.0",
    profile: new KotlinLanguageProfile(),
  },
  {
    bucketName: "zig",
    packageName: "@tree-sitter-grammars/tree-sitter-zig",
    version: "1.1.2",
    profile: new ZigLanguageProfile(),
  },
];

export function getLanguageProfile(extension: string) {
  return LANGUAGE_REGISTRY.find(({ profile }) => profile.extensions.has(extension))?.profile;
}

export function getSupportedExtensions() {
  const supported = new Set<string>();
  LANGUAGE_REGISTRY.forEach(({ profile }) => {
    profile.extensions.forEach((extension) => supported.add(extension));
  });
  return supported;
}

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

export { collectSymbols, formatSymbolName } from "./symbols.js";
export type { LanguageProfile, LanguageSymbol } from "./types.js";
export const SYMBOL_KINDS = ["func", "class", "method", "decl", "deps", "public"] as const;
