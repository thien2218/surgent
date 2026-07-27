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
import type { AgentMode, SettingsSchema } from "../agent/types.js";

interface LocalSchema {
  project?: PermissionRule;
  [sessionId: string]: PermissionRule | undefined;
}

export async function writeRules(data: PermissionRule | LocalSchema, cwd: string = "") {
  return writeJson(getPiPath("permissions", cwd), data);
}

export function readRules(cwd: string): Promise<LocalSchema>;
export function readRules(): Promise<PermissionRule>;
export function readRules(cwd: string = ""): Promise<LocalSchema | PermissionRule> {
  return readJson<LocalSchema | PermissionRule>(getPiPath("permissions", cwd), {});
}

export async function readAgentMode(cwd: string): Promise<AgentMode> {
  const settings = await readJson<SettingsSchema>(getPiPath("settings", cwd), {});
  return settings.agent?.mode === "yolo" ? "yolo" : "assistant";
}

export async function writeAgentMode(cwd: string, agentMode: AgentMode) {
  const settings = await readJson<SettingsSchema>(getPiPath("settings", cwd), {});
  settings.agent = { mode: agentMode, meta: settings.agent?.meta ?? {} };
  await writeJson(getPiPath("settings", cwd), settings);
}

async function mutateRules(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  mutate: (rules: Record<string, FileAccess | boolean>) => void,
) {
  if (scope === "always") {
    const global = await readRules();
    const rules = { ...global[category] };

    mutate(rules);
    global[category] = rules;
    await writeRules(global);
    return;
  }

  const local = await readRules(cwd);
  const scopeKey = scope === "project" ? "project" : sessionId;
  const scopeSchema: PermissionRule = local[scopeKey] ?? {};
  const rules = { ...scopeSchema[category] };

  mutate(rules);
  scopeSchema[category] = rules;
  local[scopeKey] = scopeSchema;
  await writeRules(local, cwd);
}

export async function addRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  expr: string,
  value: boolean | FileAccess,
) {
  await mutateRules(cwd, sessionId, scope, category, (rules) => {
    rules[expr] = value;
  });
}

export async function removeRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  expr: string,
) {
  await mutateRules(cwd, sessionId, scope, category, (rules) => {
    delete rules[expr];
  });
}

export async function toggleRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  expr: string,
) {
  await mutateRules(cwd, sessionId, scope, category, (rules) => {
    if (category === "file") {
      const cycle: FileAccess[] = ["write", "read", "blocked"];
      const currentValue = rules[expr] as FileAccess | undefined;
      const cycleIndex = cycle.indexOf(currentValue as FileAccess);
      rules[expr] = cycle[(cycleIndex + 1) % cycle.length]!;
      return;
    }

    const currentValue = rules[expr] as boolean | undefined;
    rules[expr] = !currentValue;
  });
}

export async function getRulesForDisplay(
  cwd: string,
  sessionId: string,
): Promise<GroupedDisplayRules> {
  const [local, global] = await Promise.all([readRules(cwd), readRules()]);
  const rules = Object.fromEntries(
    CATEGORIES.map((cat) => [cat, [] as DisplayRule[]]),
  ) as GroupedDisplayRules;

  const addFromSchema = (schema: PermissionRule | undefined, scope: Scope) => {
    if (!schema) return;

    for (const category of CATEGORIES) {
      if (!rules[category]) return;
      const categoryRules = schema[category] ?? {};
      for (const [expr, value] of Object.entries(categoryRules)) {
        rules[category].push({ expr, value: value as FileAccess | boolean, scope, category });
      }
    }
  };

  addFromSchema(local[sessionId], "session");
  addFromSchema(local.project, "project");
  addFromSchema(global, "always");

  return rules;
}
