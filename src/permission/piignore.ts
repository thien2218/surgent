import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isRelativeToRoot, resolvePermissionPath } from "./resolution.js";
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
  glob = false,
): Promise<string | null> {
  const rules = await loadPiIgnoreRules(cwd);
  if (rules.length === 0) return null;

  const path = glob ? rawPath : (await resolvePermissionPath(rawPath, cwd)).relative;
  const matchedRule = findBestPiIgnoreRule(rules, path, cwd);
  return matchedRule && !matchedRule.negated
    ? `Path blocked by .piignore rule "${matchedRule.raw}"`
    : null;
}

export function getPiIgnoreInputs(event: ToolCallEvent): Array<{ path: string; glob?: boolean }> {
  switch (event.toolName) {
    case "read":
    case "write":
    case "edit":
      return [{ path: (event as ReadToolCallEvent).input.path }];
    case "grep": {
      const grepEvent = event as GrepToolCallEvent;
      const inputs: Array<{ path: string; glob?: boolean }> = [];
      if (grepEvent.input.path) inputs.push({ path: grepEvent.input.path });
      if (grepEvent.input.glob) inputs.push({ path: grepEvent.input.glob, glob: true });
      return inputs;
    }
    default:
      return [];
  }
}
