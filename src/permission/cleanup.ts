import { SessionManager } from "@earendil-works/pi-coding-agent";
import { matchesPattern } from "./resolution.js";
import { readGlobal, readLocal, writeGlobal, writeLocal } from "./storage.js";
import type { FileAccess, PermissionRule } from "./types.js";

function pruneRules<T extends FileAccess | boolean>(rules: Record<string, T>): Record<string, T> {
  const keys = Object.keys(rules);
  const result: Record<string, T> = {};

  for (const key of keys) {
    const value = rules[key]!;
    const isSubsumed = keys.some((other) => {
      if (other === key) return false;
      if (rules[other] !== value) return false;
      // other subsumes key if other matches key but key does not match other
      return matchesPattern(key, other) && !matchesPattern(other, key);
    });
    if (!isSubsumed) {
      result[key] = value;
    }
  }

  return result;
}

function pruneSchema(schema: PermissionRule): PermissionRule {
  const result: PermissionRule = {};
  if (schema.file) {
    const pruned = pruneRules(schema.file);
    if (Object.keys(pruned).length > 0) result.file = pruned;
  }
  if (schema.web) {
    const pruned = pruneRules(schema.web as Record<string, boolean>);
    if (Object.keys(pruned).length > 0) result.web = pruned;
  }
  if (schema.bash) {
    const pruned = pruneRules(schema.bash as Record<string, boolean>);
    if (Object.keys(pruned).length > 0) result.bash = pruned;
  }
  return result;
}

export async function cleanup(cwd: string): Promise<void> {
  await Promise.all([cleanupLocal(cwd), cleanupGlobal()]);
}

async function cleanupLocal(cwd: string): Promise<void> {
  const [local, sessions] = await Promise.all([readLocal(cwd), SessionManager.list(cwd)]);
  const existingIds = new Set(sessions.map((s) => s.id));
  let changed = false;

  for (const key of Object.keys(local)) {
    if (key !== "project" && !existingIds.has(key)) {
      delete local[key];
      changed = true;
    }
  }

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
