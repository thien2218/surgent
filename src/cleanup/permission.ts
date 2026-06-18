import { matchesPattern } from "../permission/resolution.js";
import { readRules, writeRules } from "../permission/storage.js";
import type { FileAccess, PermissionRule } from "../permission/types.js";
import { pruneSessionMap } from "./helpers.js";

function pruneRules<T extends FileAccess | boolean>(
  rules: Record<string, T>,
  bash = false,
): Record<string, T> {
  const patterns = Object.keys(rules);
  const result: Record<string, T> = {};

  for (const pattern of patterns) {
    const value = rules[pattern]!;
    const isSubsumed = patterns.some((other) => {
      if (other === pattern) return false;
      if (rules[other] !== value) return false;
      // other subsumes pattern if other matches pattern but pattern does not match other
      return matchesPattern(pattern, other, bash) && !matchesPattern(other, pattern, bash);
    });
    if (!isSubsumed) {
      result[pattern] = value;
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
    const pruned = pruneRules(schema.web);
    if (Object.keys(pruned).length > 0) result.web = pruned;
  }
  if (schema.bash) {
    const pruned = pruneRules(schema.bash, true);
    if (Object.keys(pruned).length > 0) result.bash = pruned;
  }
  return result;
}

export async function cleanupPermissions(cwd: string, sessionIds: Set<string>) {
  cleanupLocal(cwd, sessionIds);
  cleanupGlobal();
}

async function cleanupLocal(cwd: string, sessionIds: Set<string>): Promise<void> {
  const local = await readRules(cwd);
  let changed = pruneSessionMap(local, sessionIds);

  if (local.project) {
    const pruned = pruneSchema(local.project);
    local.project = pruned;
    changed = true;
  }

  if (changed) {
    await writeRules(local, cwd);
  }
}

async function cleanupGlobal(): Promise<void> {
  const global = await readRules();
  const pruned = pruneSchema(global);
  await writeRules(pruned);
}
