import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LANGUAGE_REGISTRY } from "./index.js";
import type { GrammarInstallSettings } from "./types.js";
import { getPiPath, isMissingFileError, readJson, runCommand, writeJson } from "../../utils.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const GRAMMAR_COVERAGE_TARGET = 0.85;
const GRAMMAR_INSTALL_KEY = "grammarInstall";

async function ensureGrammarCachePackage() {
  const grammarCacheDir = getPiPath("grammars");
  const jsonPath = resolve(grammarCacheDir, "package.json");

  try {
    await readFile(jsonPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
    await writeJson(jsonPath, {
      name: "tree-sitter-grammars",
      private: true,
      dependencies: {},
    });
  }
}

async function getRepositoryRoot(cwd: string) {
  try {
    const { stdout } = await runCommand(cwd, "git", ["rev-parse", "--show-toplevel"]);
    const repoRoot = stdout.trim();
    return repoRoot.length > 0 ? repoRoot : undefined;
  } catch {
    return undefined;
  }
}

async function selectSupportedBuckets(cwd: string) {
  const bucketCounts = new Map<string, number>();
  let totalFileCount = 0;

  const { stdout } = await runCommand(cwd, "bash", [
    "-lc",
    "git ls-files | sed 's/.*\\.//' | sort | uniq -c | sort -rn",
  ]);

  for (const line of stdout.split(/\r?\n/)) {
    const lineMatch = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!lineMatch) continue;

    const rawCount = lineMatch[1];
    const rawExtension = lineMatch[2];
    if (!rawCount || !rawExtension) continue;

    const count = Number.parseInt(rawCount, 10);
    const extension = `.${rawExtension.toLowerCase()}`;
    if (!Number.isFinite(count) || count <= 0) continue;

    totalFileCount += count;
    for (const languageEntry of LANGUAGE_REGISTRY) {
      if (!languageEntry.profile.extensions.has(extension)) continue;
      const nextCount = bucketCounts.get(languageEntry.bucketName) ?? 0;
      bucketCounts.set(languageEntry.bucketName, nextCount + count);
      break;
    }
  }

  if (totalFileCount === 0) return [];
  const rankedBuckets = LANGUAGE_REGISTRY.map((languageEntry) => ({
    count: bucketCounts.get(languageEntry.bucketName) ?? 0,
    packageName: languageEntry.packageName,
    version: languageEntry.version,
  }))
    .filter((bucket) => bucket.count > 0)
    .sort((leftBucket, rightBucket) => rightBucket.count - leftBucket.count);

  let coveredCount = 0;
  const pickedBuckets: Array<{ packageName: string; version: string }> = [];
  for (const bucket of rankedBuckets) {
    if (coveredCount / totalFileCount >= GRAMMAR_COVERAGE_TARGET) break;
    coveredCount += bucket.count;
    pickedBuckets.push({
      packageName: bucket.packageName,
      version: bucket.version,
    });
  }

  return pickedBuckets;
}

function getMissingGrammarPackages(pickedBuckets: Array<{ packageName: string; version: string }>) {
  const grammarCacheDir = getPiPath("grammars");

  return pickedBuckets
    .filter((bucket) => {
      const packagePath = resolve(
        grammarCacheDir,
        "node_modules",
        bucket.packageName,
        "package.json",
      );
      return !existsSync(packagePath);
    })
    .map((bucket) => `${bucket.packageName}@${bucket.version}`);
}

function readGrammarInstallSettings(settings: Record<string, unknown>) {
  const rawSettings = settings[GRAMMAR_INSTALL_KEY];
  if (!rawSettings || typeof rawSettings !== "object") return {};

  const settingsMap = rawSettings as Record<string, unknown>;
  const allowed = Array.isArray(settingsMap.allowedRepos)
    ? settingsMap.allowedRepos.filter((repo) => typeof repo === "string")
    : undefined;
  const denied = Array.isArray(settingsMap.deniedRepos)
    ? settingsMap.deniedRepos.filter((repo) => typeof repo === "string")
    : undefined;

  return { allowedRepos: allowed, deniedRepos: denied } satisfies GrammarInstallSettings;
}

async function updateGrammarInstallSettings(
  settings: Record<string, unknown>,
  installSettings: GrammarInstallSettings,
) {
  settings[GRAMMAR_INSTALL_KEY] = installSettings;
  await writeJson(getPiPath("settings"), settings);
}

export async function ensureGrammarCache(ctx: ExtensionContext) {
  await ensureGrammarCachePackage();

  const repoRoot = await getRepositoryRoot(ctx.cwd);
  if (!repoRoot) return;

  const settings = await readJson<Record<string, unknown>>(getPiPath("settings"), {});
  const installSettings = readGrammarInstallSettings(settings);
  const allowed = new Set(installSettings.allowedRepos ?? []);
  const denied = new Set(installSettings.deniedRepos ?? []);
  if (denied.has(repoRoot)) return;

  const pickedBuckets = await selectSupportedBuckets(ctx.cwd);
  if (pickedBuckets.length === 0) return;

  const missingPkgs = getMissingGrammarPackages(pickedBuckets);
  if (missingPkgs.length === 0) return;

  let canInstall = allowed.has(repoRoot);
  if (!canInstall) {
    if (!ctx.hasUI) return;

    canInstall = await ctx.ui.confirm(
      "Install tree-sitter grammars for this repo?",
      "Surgent installs missing parser grammars for optimized code read, input tokens and context optimizations.",
    );

    if (!canInstall) {
      denied.add(repoRoot);
      await updateGrammarInstallSettings(settings, {
        allowedRepos: [...allowed],
        deniedRepos: [...denied],
      });
      return;
    }

    allowed.add(repoRoot);
    await updateGrammarInstallSettings(settings, {
      allowedRepos: [...allowed],
      deniedRepos: [...denied],
    });
  }

  await runCommand(getPiPath("grammars"), "npm", ["install", "--save-exact", ...missingPkgs]);
}

export async function loadGrammarModule(pkgName: string) {
  const grammarCacheDir = getPiPath("grammars");
  const cacheRequire = createRequire(resolve(grammarCacheDir, "package.json"));

  let entryPath = "";
  try {
    entryPath = cacheRequire.resolve(pkgName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `grammar package not installed in cache (${grammarCacheDir}): ${pkgName}. ${message}`,
    );
  }

  try {
    return await import(pathToFileURL(entryPath).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed loading grammar module from cache (${grammarCacheDir}): ${pkgName}. ${message}`,
    );
  }
}
