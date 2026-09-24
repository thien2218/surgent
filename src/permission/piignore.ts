import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isRelativeToRoot, resolvePermissionPath } from "./resolution.js";
import { matchesPattern, specificity } from "./precedence.js";
import { getPiPath, isMissingFileError } from "../utils.js";

const PI_IGNORE_FILE = ".piignore";

interface PiIgnoreRule {
  raw: string;
  pattern: string;
  negated: boolean;
  suffix: number;
  length: number;
  scope: number;
}

function normalizePiIgnorePattern(pattern: string): string | null {
  let normalizedPattern = pattern.replace(/\\/g, "/");
  const directoryOnly = normalizedPattern.endsWith("/");

  normalizedPattern = normalizedPattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalizedPattern || normalizedPattern === ".") {
    return null;
  }
  if (directoryOnly) {
    return `${normalizedPattern}/**`;
  }

  return normalizedPattern;
}

function parsePiIgnoreRules(contents: string, scope: number): PiIgnoreRule[] {
  const rules: PiIgnoreRule[] = [];

  for (const [order, raw] of contents.split(/\r?\n/).entries()) {
    if (!raw || raw.startsWith("#")) continue;
    if (raw === "!" || raw.includes("\0")) {
      throw new Error(`Invalid .piignore rule on line ${order + 1}`);
    }

    const negated = raw.startsWith("!");
    const rawPattern = negated ? raw.slice(1) : raw;
    const pattern = normalizePiIgnorePattern(rawPattern);
    if (!pattern) continue;

    const [suffix, length] = specificity(pattern);
    rules.push({ raw, pattern, negated, suffix, length, scope });
  }

  return rules;
}

async function loadPiIgnoreRules(cwd: string): Promise<PiIgnoreRule[]> {
  const paths = [
    resolve(cwd, PI_IGNORE_FILE),
    resolve(dirname(getPiPath("settings")), PI_IGNORE_FILE),
  ];
  const scopes = await Promise.all(
    paths.map(async (path, scope) => {
      let contents: string;
      try {
        contents = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFileError(error)) return [];
        throw error;
      }
      return parsePiIgnoreRules(contents, scope);
    }),
  );
  return scopes.flat();
}

function findBestPiIgnoreRule(
  rules: PiIgnoreRule[],
  path: string,
  cwd: string,
): PiIgnoreRule | null {
  if (!isRelativeToRoot(path, cwd)) return null;

  let best: PiIgnoreRule | null = null;
  for (const rule of rules) {
    if (!matchesPattern(path, rule.pattern)) continue;
    if (
      best === null ||
      rule.suffix > best.suffix ||
      (rule.suffix === best.suffix && rule.length > best.length) ||
      (rule.suffix === best.suffix &&
        rule.length === best.length &&
        (rule.scope < best.scope || (rule.scope === best.scope && !rule.negated)))
    ) {
      best = rule;
    }
  }

  return best;
}

export async function resolvePiIgnorePathBlock(
  cwd: string,
  rawPath: string,
): Promise<string | null> {
  const rules = await loadPiIgnoreRules(cwd);
  if (rules.length === 0) return null;

  const { relative } = await resolvePermissionPath(rawPath, cwd);
  const matchedRule = findBestPiIgnoreRule(rules, relative, cwd);
  return matchedRule && !matchedRule.negated
    ? `Path blocked by .piignore rule "${matchedRule.raw}"`
    : null;
}
