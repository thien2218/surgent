import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getRelativePathInRoot } from "./resolution.js";
import { matchesPattern, specificity } from "./precedence.js";
import { getPiPath, isMissingFileError } from "../utils.js";
import type {
  GrepToolCallEvent,
  ReadToolCallEvent,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

const PI_IGNORE_FILE = ".piignore";

interface PiIgnoreRule {
  raw: string;
  pattern: string;
  negated: boolean;
  suffix: number;
  length: number;
  scope: number;
}

function normalizePathToRoot(rawPath: string, rootPath: string): string | null {
  const relativePath = getRelativePathInRoot(rawPath, rootPath);
  if (relativePath === null) return null;

  const posixPath = (relativePath === "" ? "." : relativePath).replace(/\\/g, "/");
  if (posixPath === "/") return posixPath;

  const trimmedPath = posixPath.replace(/\/+$/, "");
  return trimmedPath || ".";
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
  rawPath: string,
  cwd: string,
): PiIgnoreRule | null {
  const normalizedPath = normalizePathToRoot(rawPath, cwd);
  if (!normalizedPath) return null;

  let best: PiIgnoreRule | null = null;
  for (const rule of rules) {
    if (!matchesPattern(normalizedPath, rule.pattern)) continue;

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

  const matchedRule = findBestPiIgnoreRule(rules, rawPath, cwd);
  if (!matchedRule || matchedRule.negated) {
    return null;
  }

  return `Path blocked by .piignore rule "${matchedRule.raw}"`;
}

export function getPiIgnoreInputs(event: ToolCallEvent): string[] {
  switch (event.toolName) {
    case "read":
    case "write":
    case "edit":
      return [(event as ReadToolCallEvent).input.path];
    case "grep": {
      const grepEvent = event as GrepToolCallEvent;
      const inputs: string[] = [];
      if (grepEvent.input.path) inputs.push(grepEvent.input.path);
      if (grepEvent.input.glob) inputs.push(grepEvent.input.glob);
      return inputs;
    }
    default:
      return [];
  }
}
