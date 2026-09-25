import pm from "picomatch";
import type { FileAccess, FileOp } from "./types.js";

const GLOB_CHARS = /[*?[\]{}()]/;

interface Match {
  permission: string;
  suffix: number;
  length: number;
  scope: number;
}

function compareBestMatch(best: Match | null, pattern: string, permission: string, scope: number) {
  const [suffix, length] = specificity(pattern);
  if (
    best === null ||
    suffix > best.suffix ||
    (suffix === best.suffix && length > best.length) ||
    (suffix === best.suffix &&
      length === best.length &&
      (scope < best.scope || (scope === best.scope && isDeny(permission))))
  ) {
    return { permission, suffix, length, scope };
  }
  return best;
}

export function specificity(pattern: string): [number, number] {
  if (!GLOB_CHARS.test(pattern)) return [Infinity, 0];
  // Suffix length is a heuristic, not glob containment.
  let suffix = 0;
  const tokens = pm.parse(pattern).tokens;
  for (let index = tokens.length - 1; index >= 0; index--) {
    const token = tokens[index]!;
    if (token.type === "bos") return [Infinity, 0];
    if (!["text", "slash", "dot"].includes(token.type)) break;
    suffix += token.value.replace(/\\(.)/g, "$1").length;
  }
  return [suffix, pattern.length];
}

export function matchesPattern(input: string, pattern: string, bash = false): boolean {
  if (pattern === input) return true;
  if (!GLOB_CHARS.test(pattern)) return false;
  try {
    return pm(pattern, { dot: true, bash })(input);
  } catch {
    return false;
  }
}

export function isDeny(permission: string) {
  return permission !== "ask" && permission !== "allowed";
}

export function findFilePermission(
  scopes: Record<string, FileAccess>[],
  path: { absolute: string; relative: string },
  operation: FileOp,
): string {
  let best: Match | null = null;
  for (const [scope, rules] of scopes.entries()) {
    for (const [pattern, value] of Object.entries(rules)) {
      if (!matchesPattern(path.absolute, pattern) && !matchesPattern(path.relative, pattern)) {
        continue;
      }
      const permission = value === "write" || value === operation ? "allowed" : pattern;
      best = compareBestMatch(best, pattern, permission, scope);
    }
  }
  return best?.permission ?? "ask";
}

export function findPermission(
  scopes: Record<string, boolean>[],
  input: string,
  bash = false,
): string {
  let best: Match | null = null;
  for (const [scope, rules] of scopes.entries()) {
    for (const [pattern, permitted] of Object.entries(rules)) {
      if (!matchesPattern(input, pattern, bash)) continue;
      const permission = permitted ? "allowed" : pattern;
      best = compareBestMatch(best, pattern, permission, scope);
    }
  }
  return best?.permission ?? "ask";
}
