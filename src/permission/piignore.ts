import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  matchesPattern,
  getRelativePathInRoot,
  specificity,
  extractPathsFromCommand,
} from "./resolution.js";
import { isMissingFileError } from "../utils.js";
import type {
  BashToolCallEvent,
  FindToolCallEvent,
  GrepToolCallEvent,
  LsToolCallEvent,
  ReadToolCallEvent,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

const PI_IGNORE_FILE = ".piignore";

interface PiIgnoreRule {
  pattern: string;
  matcher: string;
  negated: boolean;
  score: number;
  order: number;
}

const piIgnoreCache: { contents: string; rules: PiIgnoreRule[] } = { contents: "", rules: [] };

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

function parsePiIgnoreRules(contents: string): PiIgnoreRule[] {
  const rules: PiIgnoreRule[] = [];

  for (const [order, pattern] of contents.split(/\r?\n/).entries()) {
    if (!pattern || pattern.startsWith("#")) continue;

    const negated = pattern.startsWith("!") && pattern !== "!";
    const rawPattern = negated ? pattern.slice(1) : pattern;
    const matcher = normalizePiIgnorePattern(rawPattern);
    if (!matcher) continue;

    rules.push({ pattern, matcher, negated, score: specificity(matcher), order });
  }

  return rules;
}

async function loadPiIgnoreRules(cwd: string): Promise<PiIgnoreRule[]> {
  const piIgnorePath = resolve(cwd, PI_IGNORE_FILE);
  let contents = "";

  try {
    contents = await readFile(piIgnorePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      piIgnoreCache.contents = "";
      piIgnoreCache.rules = [];
      return [];
    }
    throw error;
  }

  if (piIgnoreCache.contents === contents) {
    return piIgnoreCache.rules;
  }

  const rules = parsePiIgnoreRules(contents);
  piIgnoreCache.contents = contents;
  piIgnoreCache.rules = rules;
  return rules;
}

function findBestPiIgnoreRule(
  rules: PiIgnoreRule[],
  rawPath: string,
  cwd: string,
): PiIgnoreRule | null {
  const normalizedPath = normalizePathToRoot(rawPath, cwd);
  if (!normalizedPath) return null;

  let bestRule: PiIgnoreRule | null = null;

  for (const rule of rules) {
    if (!matchesPattern(normalizedPath, rule.matcher)) continue;

    if (
      bestRule === null ||
      rule.score > bestRule.score ||
      (rule.score === bestRule.score && rule.order > bestRule.order)
    ) {
      bestRule = rule;
    }
  }

  return bestRule;
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

  return `Path blocked by .piignore rule "${matchedRule.pattern}"`;
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
    case "find": {
      const findEvent = event as FindToolCallEvent;
      const inputs = [findEvent.input.pattern];
      if (findEvent.input.path) inputs.push(findEvent.input.path);
      return inputs;
    }
    case "ls": {
      const lsEvent = event as LsToolCallEvent;
      return lsEvent.input.path ? [lsEvent.input.path] : [];
    }
    case "bash":
      return extractPathsFromCommand((event as BashToolCallEvent).input.command);
    default:
      return [];
  }
}
