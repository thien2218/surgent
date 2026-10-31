import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureGrammarCache, loadGrammarModule } from "../../../src/optimizer/grammar/ensure.js";
import { TypeScriptLanguageProfile } from "../../../src/optimizer/grammar/languages/typescript.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-grammar-" });
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

describe("project language detection", () => {
  const settingsPath = () => join(workspace.cwd, ".pi", "settings.json");
  const readSettings = async () => JSON.parse(await readFile(settingsPath(), "utf8"));

  async function trackFiles(counts: Record<string, number>) {
    for (const [extension, count] of Object.entries(counts)) {
      for (let index = 0; index < count; index += 1) {
        await writeFile(join(workspace.cwd, `file${index}${extension}`), "");
      }
    }
    execFileSync("git", ["init", "-q"], { cwd: workspace.cwd });
    execFileSync("git", ["add", "."], { cwd: workspace.cwd });
  }

  beforeEach(async () => {
    await mkdir(join(workspace.home, ".pi", "agent", "grammars"), { recursive: true });
  });

  it("saves the main languages from supported files only and keeps other settings", async () => {
    await writeFile(settingsPath(), JSON.stringify({ model: "fixture" }));
    await trackFiles({ ".md": 20, ".ts": 9, ".py": 1 });

    await ensureGrammarCache({ cwd: workspace.cwd, hasUI: false } as ExtensionContext);

    expect(await readSettings()).toEqual({ model: "fixture", languages: ["typescript"] });
  });

  it("keeps saved languages instead of detecting again and still reports them", async () => {
    await writeFile(settingsPath(), JSON.stringify({ languages: ["python"] }));
    await trackFiles({ ".ts": 3 });
    const ui = { setWidget: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => false) };

    await ensureGrammarCache({ cwd: workspace.cwd, hasUI: true, ui } as unknown as ExtensionContext);

    expect(await readSettings()).toEqual({ languages: ["python"] });
    expect(ui.setWidget).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("python"), "info");
  });

  it("shows a loader while detecting and reports the saved languages", async () => {
    await trackFiles({ ".py": 2 });
    const ui = { setWidget: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => false) };

    await ensureGrammarCache({ cwd: workspace.cwd, hasUI: true, ui } as unknown as ExtensionContext);

    expect(ui.setWidget.mock.calls).toEqual([["grammar", expect.any(Function)], ["grammar", undefined]]);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("python"), "info");
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
