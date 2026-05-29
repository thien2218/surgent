import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Category, DisplayRule, FileAccess, LocalSchema, PermSchema, Scope } from "./types.js";
import { getPiGlobalPath, getPiLocalPath } from "../utils.js";

const PERMISSIONS_FILE = "permissions.json";
const GLOBAL_PERMISSIONS = getPiGlobalPath(PERMISSIONS_FILE);

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function readLocal(cwd: string): Promise<LocalSchema> {
  return readJson<LocalSchema>(getPiLocalPath(cwd, PERMISSIONS_FILE), {});
}

export async function writeLocal(cwd: string, data: LocalSchema): Promise<void> {
  return writeJson(getPiLocalPath(cwd, PERMISSIONS_FILE), data);
}

export async function readGlobal(): Promise<PermSchema> {
  return readJson<PermSchema>(GLOBAL_PERMISSIONS, {});
}

export async function writeGlobal(data: PermSchema): Promise<void> {
  return writeJson(GLOBAL_PERMISSIONS, data);
}

function getScopeKey(scope: Scope, sessionId: string): string {
  return scope === "project" ? "project" : sessionId;
}

function getCategoryRules(
  schema: PermSchema,
  category: Category,
): Record<string, FileAccess | boolean> {
  if (category === "file") return (schema.file as Record<string, FileAccess>) ?? {};
  if (category === "web") return schema.web ?? {};
  return schema.bash ?? {};
}

function setCategoryRules(
  schema: PermSchema,
  category: Category,
  rules: Record<string, FileAccess | boolean>,
): void {
  if (category === "file") schema.file = rules as Record<string, FileAccess>;
  else if (category === "web") schema.web = rules as Record<string, boolean>;
  else schema.bash = rules as Record<string, boolean>;
}

export async function addRule(
  cwd: string,
  scope: Scope,
  sessionId: string,
  category: Category,
  expr: string,
  value: boolean | FileAccess,
): Promise<void> {
  if (scope === "always") {
    const global = await readGlobal();
    const rules = { ...getCategoryRules(global, category), [expr]: value };
    setCategoryRules(global, category, rules);
    await writeGlobal(global);
  } else {
    const local = await readLocal(cwd);
    const scopeKey = getScopeKey(scope, sessionId);
    const scopeSchema: PermSchema = local[scopeKey] ?? {};
    const rules = { ...getCategoryRules(scopeSchema, category), [expr]: value };
    setCategoryRules(scopeSchema, category, rules);
    local[scopeKey] = scopeSchema;
    await writeLocal(cwd, local);
  }
}

export async function removeRule(
  cwd: string,
  scope: Scope,
  sessionId: string,
  category: Category,
  expr: string,
): Promise<void> {
  if (scope === "always") {
    const global = await readGlobal();
    const rules = { ...getCategoryRules(global, category) };
    delete rules[expr];
    setCategoryRules(global, category, rules);
    await writeGlobal(global);
  } else {
    const local = await readLocal(cwd);
    const scopeKey = getScopeKey(scope, sessionId);
    const scopeSchema: PermSchema = local[scopeKey] ?? {};
    const rules = { ...getCategoryRules(scopeSchema, category) };
    delete rules[expr];
    setCategoryRules(scopeSchema, category, rules);
    local[scopeKey] = scopeSchema;
    await writeLocal(cwd, local);
  }
}

export async function toggleRule(
  cwd: string,
  scope: Scope,
  sessionId: string,
  category: Category,
  expr: string,
): Promise<void> {
  let currentValue: boolean | FileAccess | undefined;

  if (scope === "always") {
    const global = await readGlobal();
    currentValue = getCategoryRules(global, category)[expr];
  } else {
    const local = await readLocal(cwd);
    const scopeKey = getScopeKey(scope, sessionId);
    const scopeSchema: PermSchema = local[scopeKey] ?? {};
    currentValue = getCategoryRules(scopeSchema, category)[expr];
  }

  let nextValue: boolean | FileAccess;
  if (category === "file") {
    const cycle: FileAccess[] = ["write", "read", "blocked"];
    const idx = cycle.indexOf(currentValue as FileAccess);
    nextValue = cycle[(idx + 1) % cycle.length]!;
  } else {
    nextValue = !currentValue;
  }

  await addRule(cwd, scope, sessionId, category, expr, nextValue);
}

export async function getRulesForDisplay(cwd: string, sessionId: string): Promise<DisplayRule[]> {
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);
  const rules: DisplayRule[] = [];
  const categories: Category[] = ["file", "web", "bash"];

  const addFromSchema = (schema: PermSchema | undefined, scope: Scope) => {
    if (!schema) return;
    for (const category of categories) {
      const categoryRules = getCategoryRules(schema, category);
      for (const [expr, value] of Object.entries(categoryRules)) {
        rules.push({ expr, value: value as FileAccess | boolean, scope, category });
      }
    }
  };

  addFromSchema(local[sessionId], "session");
  addFromSchema(local.project, "project");
  addFromSchema(global, "always");

  return rules;
}
