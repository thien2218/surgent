import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { filterLanguages, getLanguageByExt, getAllLanguages } from "./index.js";
import type { GrammarInstallSettings } from "./types.js";
import { getPiPath, isMissingFileError, readJson, runCommand, writeJson } from "../../utils.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const GRAMMAR_COVERAGE_TARGET = 0.9;
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
    await writeJson(jsonPath, { name: "tree-sitter-grammars", private: true, dependencies: {} });
  }
}

async function getRepositoryRoot(cwd: string) {
  try {
    const { stdout } = await runCommand(cwd, "git", ["rev-parse", "--show-toplevel"]);
    const repoRoot = stdout.trim();
    return repoRoot.length > 0 ? repoRoot : undefined;
  } catch {}
}

async function detectLanguages(cwd: string) {
  const bucketCounts = new Map<string, number>();
  let supportedCount = 0;

  const { stdout } = await runCommand(cwd, "git", ["ls-files", "-z"]);
  for (const filePath of stdout.split("\0")) {
    const extension = extname(filePath).toLowerCase();
    const { name } = getLanguageByExt(extension);
    if (!name) continue;

    supportedCount += 1;
    const nextCount = bucketCounts.get(name) ?? 0;
    bucketCounts.set(name, nextCount + 1);
  }

  let coveredCount = 0;
  const detected: string[] = [];
  const rankedBuckets = getAllLanguages()
    .map(({ name }) => ({ name, count: bucketCounts.get(name) ?? 0 }))
    .sort((leftBucket, rightBucket) => rightBucket.count - leftBucket.count);

  for (const bucket of rankedBuckets) {
    if (supportedCount === 0 || coveredCount / supportedCount >= GRAMMAR_COVERAGE_TARGET) break;
    coveredCount += bucket.count;
    detected.push(bucket.name);
  }

  return detected;
}

export async function readLanguages(cwd: string) {
  const settings = await readJson<Record<string, unknown>>(getPiPath("settings", cwd), {});
  const languages = settings["languages"];
  if (!Array.isArray(languages)) return;
  return filterLanguages(languages);
}

async function ensureLanguages(ctx: ExtensionContext) {
  const languages = await readLanguages(ctx.cwd);
  if (languages) return languages;

  if (ctx.hasUI) {
    ctx.ui.setWidget("grammar", (tui, theme) => {
      const loader = new Loader(
        tui,
        (content) => theme.fg("accent", content),
        (content) => theme.fg("muted", content),
        "Detecting project languages...",
      );
      return Object.assign(loader, { dispose: () => loader.stop() });
    });
  }

  try {
    const detected = await detectLanguages(ctx.cwd);
    const settingsPath = getPiPath("settings", ctx.cwd);
    const settings = await readJson<Record<string, unknown>>(settingsPath, {});
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeJson(settingsPath, { ...settings, languages: detected });
    return filterLanguages(detected);
  } finally {
    if (ctx.hasUI) ctx.ui.setWidget("grammar", undefined);
  }
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

  const languages = await ensureLanguages(ctx);
  if (ctx.hasUI) {
    const message =
      languages.length > 0
        ? `Languages set for this project: ${languages.map(({ name }) => name).join(", ")}. Edit "languages" in .pi/settings.json to change.`
        : 'No languages set for this project. Add them to "languages" in .pi/settings.json.';
    ctx.ui.notify(message, "info");
  }

  const settings = await readJson<Record<string, unknown>>(getPiPath("settings"), {});
  const installSettings = readGrammarInstallSettings(settings);
  const allowedRepos = installSettings.allowedRepos ?? [];
  const deniedRepos = installSettings.deniedRepos ?? [];
  if (deniedRepos.includes(repoRoot)) return;

  const missingPkgs = getMissingGrammarPackages(languages);
  if (missingPkgs.length === 0) return;

  let canInstall = allowedRepos.includes(repoRoot);
  if (!canInstall) {
    if (!ctx.hasUI) return;

    canInstall = await ctx.ui.confirm(
      "Install tree-sitter grammars for this repo?",
      "surgent installs grammars for parsing code reads and context optimizations.",
    );
    if (!canInstall) {
      deniedRepos.push(repoRoot);
      await updateGrammarInstallSettings(settings, { allowedRepos, deniedRepos });
      return;
    }

    allowedRepos.push(repoRoot);
    await updateGrammarInstallSettings(settings, { allowedRepos, deniedRepos });
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
