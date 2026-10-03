import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { loadGrammarModule } from "../../../src/optimizer/languages/grammar.js";
import { TypeScriptLanguageProfile } from "../../../src/optimizer/languages/typescript.js";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-grammar-");
  onTestFinished(() => workspace.restore());
});

async function cachePackage(name: string, source: string, type: "module" | "commonjs" = "module") {
  const directory = join(workspace.home, ".pi", "agent", "grammars", "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name, type, main: "index.js" }));
  await writeFile(join(directory, "index.js"), source);
}

describe("grammar cache loading", () => {
  it("reports an absent grammar without creating a cache or installing packages", async () => {
    const cache = join(workspace.home, ".pi", "agent", "grammars");

    await expect(loadGrammarModule("surgent-missing-grammar"))
      .rejects.toThrow(`grammar package not installed in cache (${cache}): surgent-missing-grammar`);
    await expect(access(cache)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["module", "commonjs"] as const)("loads a local %s grammar package without native parsers", async (type) => {
    await cachePackage("fixture-grammar", type === "module"
      ? 'export default { language: "fixture" };'
      : 'module.exports = { language: "fixture" };', type);

    const loaded = await loadGrammarModule("fixture-grammar");

    expect(loaded.default).toEqual({ language: "fixture" });
  });

  it("distinguishes an installed but broken grammar from a missing package", async () => {
    await cachePackage("broken-grammar", 'throw new Error("fixture ABI mismatch");');

    await expect(loadGrammarModule("broken-grammar"))
      .rejects.toThrow(/failed loading grammar module from cache .*broken-grammar\. fixture ABI mismatch/);
  });
});

describe("TypeScript grammar exports", () => {
  it.each(["module", "commonjs"] as const)("selects JSX grammar for TSX and JSX from %s exports", async (type) => {
    // Language handles stay inert: this suite tests package/extension selection, not parsing.
    await cachePackage("tree-sitter-typescript", type === "module"
      ? 'export const typescript = { dialect: "ts" }; export const tsx = { dialect: "tsx" };'
      : 'module.exports = { typescript: { dialect: "ts" }, tsx: { dialect: "tsx" } };', type);
    const language = new TypeScriptLanguageProfile();

    for (const extension of [".ts", ".js", ".mjs", ".cjs"]) {
      await expect(language.loadLanguage(extension)).resolves.toEqual({ dialect: "ts" });
    }
    for (const extension of [".tsx", ".jsx"]) {
      await expect(language.loadLanguage(extension)).resolves.toEqual({ dialect: "tsx" });
    }
  });

  it("falls back to TypeScript when a grammar package omits TSX", async () => {
    await cachePackage("tree-sitter-typescript", 'export default { typescript: { dialect: "ts" } };');
    const language = new TypeScriptLanguageProfile();

    await expect(language.loadLanguage(".tsx")).resolves.toEqual({ dialect: "ts" });
    await expect(language.loadLanguage(".jsx")).resolves.toEqual({ dialect: "ts" });
  });

  it("rejects an incompatible grammar export instead of returning an undefined handle", async () => {
    await cachePackage("tree-sitter-typescript", 'export default { tsx: { dialect: "tsx" } };');

    await expect(new TypeScriptLanguageProfile().loadLanguage(".ts"))
      .rejects.toThrow("tree-sitter-typescript missing typescript export");
  });
});
