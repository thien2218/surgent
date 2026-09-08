import pm from "picomatch";
import type { FileAccess } from "./types.js";

const GLOB_CHARS = /[*?[\]{}]/;

export function specificity(pattern: string): number {
  return GLOB_CHARS.test(pattern) ? pattern.length : Infinity;
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

export function findScopedPermission(
  scopes: Array<Record<string, FileAccess | boolean>>,
  input: string,
  bash = false,
  fileOp?: "read" | "write",
): "allowed" | "blocked" | "ask" {
  for (const rules of scopes) {
    let best: { permission: "allowed" | "blocked"; score: number } | null = null;
    for (const [pattern, value] of Object.entries(rules)) {
      if (!matchesPattern(input, pattern, bash)) continue;

      const permission =
        typeof value === "boolean"
          ? value
            ? "allowed"
            : "blocked"
          : value === "write" || value === fileOp
            ? "allowed"
            : "blocked";
      const score = specificity(pattern);

      if (
        best === null ||
        score > best.score ||
        (score === best.score && permission === "blocked")
      ) {
        best = { permission, score };
      }
    }
    if (best) return best.permission;
  }

  return "ask";
}
