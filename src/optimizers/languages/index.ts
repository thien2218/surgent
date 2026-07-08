import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureGrammarCache } from "./grammar.js";
import type { LanguageProfile } from "./types.js";
import { TypeScriptLanguageProfile } from "./typescript.js";
import { PythonLanguageProfile } from "./python.js";
import { GoLanguageProfile } from "./go.js";
import { JavaLanguageProfile } from "./java.js";

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

export { collectSymbols } from "./symbols.js";
export type { LanguageProfile, LanguageSymbol } from "./types.js";
export const SYMBOL_KINDS = [
  "function",
  "class",
  "class_method",
  "object_method",
  "top_level_var",
  "import",
  "export",
] as const;
