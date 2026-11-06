import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll } from "vitest";
import { collectSymbols } from "../../src/optimizer/grammar/index.js";
import { inspectSymbol } from "../../src/optimizer/inspector/inspect.js";
import { formatRange } from "../../src/optimizer/mapper/helpers.js";
import { createWorkspace } from "./workspace.js";

export const fixturesRoot = fileURLToPath(new URL("../fixtures/languages/", import.meta.url));
export const modulesRoot = fileURLToPath(new URL("../../node_modules/", import.meta.url));

/** Serves the checkout's grammar devDependencies from an isolated HOME's grammar cache for one test file. */
export function useGrammarCache() {
  beforeAll(async () => {
    const workspace = await createWorkspace({
      prefix: "surgent-languages-",
      restoreAfterTest: false,
    });
    try {
      const cache = join(workspace.home, ".pi", "agent", "grammars");
      await mkdir(cache, { recursive: true });
      await symlink(modulesRoot, join(cache, "node_modules"), "junction");
    } catch (error) {
      await workspace.restore();
      throw error;
    }
    return workspace.restore;
  });
}

export async function collectFixture(file: string, kinds?: string[]) {
  return collectSymbols(fixturesRoot, file, kinds && new Set(kinds));
}

/** Lists a fixture's symbols one per line by kind, `inspect` name, and line range. */
export async function mapFixture(file: string, kinds?: string[]) {
  const symbols = await collectFixture(file, kinds);
  return symbols.map(({ kind, name, range }) => {
    const isGroup = kind === "import" || kind === "export";
    const tag = isGroup ? "" : `[${kind}] `;
    return `${tag}${name} ${formatRange(range)}`;
  });
}

export async function inspectFixture(file: string, symbol: string, signature = false) {
  return (await inspectSymbol(fixturesRoot, file, symbol, signature))?.text;
}
