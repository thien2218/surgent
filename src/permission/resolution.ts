import pm from "picomatch";
import { readGlobal, readLocal } from "./storage.js";
import type { Category, FileAccess, PermSchema } from "./types.js";

const GLOB_CHARS = /[*?[\]{}]/;

function hasGlobChars(pattern: string): boolean {
  return GLOB_CHARS.test(pattern);
}

function specificity(pattern: string): number {
  return hasGlobChars(pattern) ? pattern.length : Infinity;
}

export function matchesPattern(key: string, pattern: string, category: Category): boolean {
  if (pattern === key) return true;
  if (!hasGlobChars(pattern)) return false;

  if (category === "web") {
    // For web URLs, * should match path separators too — convert * to ** for picomatch
    const normalized = pattern.replace(/\*/g, "**");
    try {
      return pm(normalized, { dot: true, nocase: false })(key);
    } catch {
      return false;
    }
  }

  try {
    return pm(pattern, { dot: true })(key);
  } catch {
    return false;
  }
}

interface BestMatch {
  value: FileAccess | boolean;
  score: number;
}

function findBestMatch(
  rules: Record<string, FileAccess | boolean>,
  key: string,
  category: Category,
): BestMatch | null {
  let best: BestMatch | null = null;

  for (const [pattern, value] of Object.entries(rules)) {
    if (!matchesPattern(key, pattern, category)) continue;
    const score = specificity(pattern);

    if (best === null || score > best.score) {
      best = { value, score };
    }
  }

  return best;
}

function getSchemaRules(
  schema: PermSchema | undefined,
  category: Category,
): Record<string, FileAccess | boolean> {
  if (!schema) return {};
  if (category === "files") return (schema.files as Record<string, FileAccess>) ?? {};
  if (category === "web") return schema.web ?? {};
  return schema.bash ?? {};
}

export async function resolvePermission(
  cwd: string,
  sessionId: string,
  category: Category,
  key: string,
  op?: "read" | "write",
): Promise<boolean> {
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);

  const scopes = [
    { schema: global, scopeName: "always" },
    { schema: local.project, scopeName: "project" },
    { schema: sessionId ? local[sessionId] : undefined, scopeName: "session" },
  ] as const;

  for (const { schema } of scopes) {
    const rules = getSchemaRules(schema, category);
    const match = findBestMatch(rules, key, category);
    if (match === null) continue;

    if (category === "files") {
      const access = match.value as FileAccess;
      if (access === "full") return true;
      if (access === "readonly") return op === "read";
      return false; // blocked
    } else {
      return match.value as boolean;
    }
  }

  if (category === "files") {
    return key.startsWith(cwd); // Defaults
  }

  return false;
}
