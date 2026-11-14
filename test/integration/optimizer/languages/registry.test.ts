import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getAllLanguages,
  getLanguageByExt,
  SHARED_KINDS,
  SYMBOL_KINDS,
} from "../../../../src/optimizer/grammar/index.js";

describe("language registry", () => {
  it("supports script variants without treating unknown extensions as code", () => {
    const extensions = getAllLanguages().flatMap(({ profile }) => [...profile.extensions]);
    expect(extensions.sort()).toEqual([
      ".c",
      ".cc",
      ".cjs",
      ".cpp",
      ".cs",
      ".cxx",
      ".gemspec",
      ".go",
      ".h",
      ".hh",
      ".hpp",
      ".hxx",
      ".java",
      ".js",
      ".jsx",
      ".kt",
      ".kts",
      ".mjs",
      ".py",
      ".rake",
      ".rb",
      ".rs",
      ".ts",
      ".tsx",
      ".zig",
    ]);
    for (const extension of [".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(getLanguageByExt(extension).name).toBe("typescript");
    }
    for (const extension of [".cc", ".cxx", ".h", ".hh", ".hpp", ".hxx"]) {
      expect(getLanguageByExt(extension).name).toBe("cpp");
    }
    expect(getLanguageByExt(".c").name).toBe("c");
    expect(getLanguageByExt(".txt")).toEqual({});
  });

  it("extends the shared kinds with distinct per-language kinds", () => {
    const extraKinds = getAllLanguages().flatMap(({ profile }) => {
      expect(new Set(profile.extraKinds).size).toBe(profile.extraKinds.length);
      return profile.extraKinds;
    });

    expect(extraKinds.filter((kind) => SHARED_KINDS.some((shared) => shared === kind))).toEqual([]);
    expect([...SYMBOL_KINDS].slice(0, SHARED_KINDS.length)).toEqual([...SHARED_KINDS]);
    expect(SYMBOL_KINDS).toEqual(new Set([...SHARED_KINDS, ...extraKinds]));
  });

  it("pins grammar devDependencies to the versions users download", async () => {
    const manifest = await readFile(new URL("../../../../package.json", import.meta.url), "utf8");
    const { devDependencies } = JSON.parse(manifest);
    const languages = getAllLanguages();

    expect(languages.map(({ packageName }) => [packageName, devDependencies[packageName]])).toEqual(
      languages.map(({ packageName, version }) => [packageName, version]),
    );
  });
});
