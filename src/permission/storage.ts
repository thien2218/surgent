import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isMissingFileError, isRecord, readJson, writeJson } from "../utils.js";
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

function validateRule(value: unknown): asserts value is PermissionRule {
  if (!isRecord(value)) throw new Error("Invalid permission rules");

  for (const [category, rules] of Object.entries(value)) {
    if (!CATEGORIES.includes(category as Category) || !isRecord(rules)) {
      throw new Error("Invalid permission rules");
    }
    for (const permission of Object.values(rules)) {
      const valid =
        category === "file"
          ? permission === "read" || permission === "write" || permission === "deny"
          : typeof permission === "boolean";
      if (!valid) throw new Error("Invalid permission rules");
    }
  }
}

export async function writeRules(data: PermissionRule | LocalSchema, cwd: string = "") {
  const filePath = getPiPath("permissions", cwd);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export function readRules(cwd: string): Promise<LocalSchema>;
export function readRules(): Promise<PermissionRule>;
export async function readRules(cwd: string = ""): Promise<LocalSchema | PermissionRule> {
  const filePath = getPiPath("permissions", cwd);
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return {};
    throw error;
  }

  if (!isRecord(parsed)) throw new Error("Invalid permission rules");
  if (!cwd) {
    validateRule(parsed);
    return parsed;
  }
  for (const rule of Object.values(parsed)) validateRule(rule);
  return parsed;
}

export async function readAgentMode(): Promise<AgentMode> {
  const settings = await readJson<SettingsSchema>(getPiPath("settings"), {});
  const mode = settings.agent?.mode ?? "assistant";
  return ["assistant", "restricted", "yolo"].includes(mode) ? mode : "assistant"; // Invalid mode fallback to "assistant"
}

export async function writeAgentMode(agentMode: AgentMode) {
  const settingsPath = getPiPath("settings");
  const settings = await readJson<SettingsSchema>(settingsPath, {});
  settings.agent = { ...settings.agent, mode: agentMode };
  await writeJson(settingsPath, settings);
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

export async function addRules(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  rules: Map<string, FileAccess | boolean>,
) {
  await mutateRules(cwd, sessionId, scope, category, (rulesSet) => {
    for (const [pattern, perm] of rules) {
      rulesSet[pattern] = perm;
    }
  });
}

export async function removeRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  pattern: string,
) {
  await mutateRules(cwd, sessionId, scope, category, (rules) => {
    delete rules[pattern];
  });
}

export async function toggleRule(
  cwd: string,
  sessionId: string,
  scope: Scope,
  category: Category,
  pattern: string,
) {
  await mutateRules(cwd, sessionId, scope, category, (rules) => {
    if (category === "file") {
      const cycle: FileAccess[] = ["write", "read", "deny"];
      const currentValue = rules[pattern] as FileAccess | undefined;
      const cycleIndex = cycle.indexOf(currentValue as FileAccess);
      rules[pattern] = cycle[(cycleIndex + 1) % cycle.length]!;
      return;
    }

    const currentValue = rules[pattern] as boolean | undefined;
    rules[pattern] = !currentValue;
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
      for (const [pattern, value] of Object.entries(categoryRules)) {
        rules[category].push({ pattern, value: value as FileAccess | boolean, scope, category });
      }
    }
  };

  addFromSchema(local[sessionId], "session");
  addFromSchema(local.project, "project");
  addFromSchema(global, "always");

  return rules;
}

export async function persistRules(
  cwd: string,
  sessionId: string,
  data: { session: PermissionRule; project: PermissionRule; global: PermissionRule },
): Promise<void> {
  const local = await readRules(cwd);
  local[sessionId] = data.session;
  local.project = data.project;

  await writeRules(local, cwd);
  await writeRules(data.global);
}
