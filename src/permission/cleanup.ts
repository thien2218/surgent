import { matchesPattern } from "./resolution.js";
import { readGlobal, readLocal, writeGlobal, writeLocal } from "./storage.js";
import type { Category, FileAccess, PermSchema } from "./types.js";

function pruneRules<T extends FileAccess | boolean>(
  rules: Record<string, T>,
  category: Category,
): Record<string, T> {
  const keys = Object.keys(rules);
  const result: Record<string, T> = {};

  for (const key of keys) {
    const value = rules[key]!;
    const isSubsumed = keys.some((other) => {
      if (other === key) return false;
      if (rules[other] !== value) return false;
      // other subsumes key if other matches key but key does not match other
      return matchesPattern(key, other, category) && !matchesPattern(other, key, category);
    });
    if (!isSubsumed) {
      result[key] = value;
    }
  }

  return result;
}

function pruneSchema(schema: PermSchema): PermSchema {
  const result: PermSchema = {};
  if (schema.files) {
    const pruned = pruneRules(schema.files, "files");
    if (Object.keys(pruned).length > 0) result.files = pruned;
  }
  if (schema.web) {
    const pruned = pruneRules(schema.web as Record<string, boolean>, "web");
    if (Object.keys(pruned).length > 0) result.web = pruned;
  }
  if (schema.bash) {
    const pruned = pruneRules(schema.bash as Record<string, boolean>, "bash");
    if (Object.keys(pruned).length > 0) result.bash = pruned;
  }
  return result;
}

export async function cleanup(cwd: string, sessionId: string): Promise<void> {
  await Promise.all([cleanupLocal(cwd, sessionId), cleanupGlobal()]);
}

async function cleanupLocal(cwd: string, sessionId: string): Promise<void> {
  const local = await readLocal(cwd);
  let changed = false;

  // Remove stale session keys (keep project and current session)
  for (const key of Object.keys(local)) {
    if (key !== "project" && key !== sessionId) {
      delete local[key];
      changed = true;
    }
  }

  // Prune redundant rules in project scope
  if (local.project) {
    const pruned = pruneSchema(local.project);
    local.project = pruned;
    changed = true;
  }

  if (changed) {
    await writeLocal(cwd, local);
  }
}

async function cleanupGlobal(): Promise<void> {
  const global = await readGlobal();
  const pruned = pruneSchema(global);
  await writeGlobal(pruned);
}
