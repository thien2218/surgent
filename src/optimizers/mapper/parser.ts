import Parser, { type Language } from "tree-sitter";

export async function createCodeParser(extension: string) {
  let language: Language | null = null;

  if (extension.startsWith(".ts")) {
    const languagePack = await import("tree-sitter-typescript");
    language =
      extension === ".tsx"
        ? ((languagePack.tsx ?? languagePack.typescript) as Language)
        : (languagePack.typescript as Language);
  }

  if (!language) {
    throw new Error("missing TypeScript grammar");
  }

  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
