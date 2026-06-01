import { readJson, writeJson } from "../utils.js";
import type {
  Category,
  GroupedDisplayRules,
  FileAccess,
  PermissionRule,
  Scope,
  DisplayRule,
} from "./types.js";
import { getPiPath } from "../utils.js";
import { CATEGORIES } from "./constants.js";

interface LocalSchema {
  project?: PermissionRule;
  [sessionId: string]: PermissionRule | undefined;
}

export async function readLocal(cwd: string): Promise<LocalSchema> {
  return readJson<LocalSchema>(getPiPath("permissions", cwd), {});
}

export async function writeLocal(cwd: string, data: LocalSchema): Promise<void> {
  return writeJson(getPiPath("permissions", cwd), data);
}

export async function readGlobal(): Promise<PermissionRule> {
  return readJson<PermissionRule>(getPiPath("permissions"), {});
}

export async function writeGlobal(data: PermissionRule): Promise<void> {
  return writeJson(getPiPath("permissions"), data);
}

function getScopeKey(scope: Scope, sessionId: string): string {
  return scope === "project" ? "project" : sessionId;
}

function getCategoryRules(
  schema: PermissionRule,
  category: Category,
): Record<string, FileAccess | boolean> {
  if (category === "file") return (schema.file as Record<string, FileAccess>) ?? {};
  if (category === "web") return schema.web ?? {};
  return schema.bash ?? {};
}

function setCategoryRules(
  schema: PermissionRule,
  category: Category,
  rules: Record<string, FileAccess | boolean>,
): void {
  if (category === "file") schema.file = rules as Record<string, FileAccess>;
  else if (category === "web") schema.web = rules as Record<string, boolean>;
  else schema.bash = rules as Record<string, boolean>;
}

export async function addRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
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
    const scopeSchema: PermissionRule = local[scopeKey] ?? {};
    const rules = { ...getCategoryRules(scopeSchema, category), [expr]: value };
    setCategoryRules(scopeSchema, category, rules);
    local[scopeKey] = scopeSchema;
    await writeLocal(cwd, local);
  }
}

export async function removeRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
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
    const scopeSchema: PermissionRule = local[scopeKey] ?? {};
    const rules = { ...getCategoryRules(scopeSchema, category) };
    delete rules[expr];
    setCategoryRules(scopeSchema, category, rules);
    local[scopeKey] = scopeSchema;
    await writeLocal(cwd, local);
  }
}

export async function toggleRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
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
    const scopeSchema: PermissionRule = local[scopeKey] ?? {};
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

  await addRule(cwd, sessionId, scope, category, expr, nextValue);
}

export async function getRulesForDisplay(
  cwd: string,
  sessionId: string,
): Promise<GroupedDisplayRules> {
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);
  const rules = Object.fromEntries(
    CATEGORIES.map((cat) => [cat, [] as DisplayRule[]]),
  ) as GroupedDisplayRules;

  const addFromSchema = (schema: PermissionRule | undefined, scope: Scope) => {
    if (!schema) return;

    for (const category of CATEGORIES) {
      if (!rules[category]) return;
      const categoryRules = schema[category] ?? {};
      for (const [expr, value] of Object.entries(categoryRules)) {
        rules[category].push({ expr, value: value as FileAccess | boolean, scope });
      }
    }
  };

  addFromSchema(local[sessionId], "session");
  addFromSchema(local.project, "project");
  addFromSchema(global, "always");

  return rules;
}

export async function checkExprStored(
  cwd: string,
  category: Category,
  expr: string,
): Promise<boolean> {
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);

  const inSchema = (schema: PermissionRule | undefined): boolean => {
    if (!schema) return false;
    const rules = category === "file" ? schema.file : category === "web" ? schema.web : schema.bash;
    return rules ? expr in rules : false;
  };

  return inSchema(global) || Object.values(local).some(inSchema);
}
