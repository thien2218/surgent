import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentMeta, AgentMode } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck, FileCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { findSubsession } from "../subagent/storage.js";
import { findScopedPermission, matchesPattern } from "./precedence.js";

function getSchemaRules(
  category: Category,
  schema?: PermissionRule,
): Record<string, FileAccess | boolean> {
  if (!schema) return {};
  if (category === "file") return schema.file ?? {};
  if (category === "web") return schema.web ?? {};
  if (category === "mcp") return schema.mcp ?? {};
  return schema.bash ?? {};
}

function getDenyRules(schema: PermissionRule): PermissionRule {
  const keys = ["file", "web", "bash", "mcp"] as const;
  const rules: PermissionRule = {};
  for (const key of keys) {
    rules[key] = Object.fromEntries(
      Object.entries(schema[key] ?? {}).filter(([, access]) => !access || access === "deny"),
    );
  }
  return rules;
}

function isAllowedByPattern(raw: string, allowList?: string[], bash?: boolean): boolean {
  return Boolean(!allowList || allowList.some((pattern) => matchesPattern(raw, pattern, bash)));
}

export function checkAgentRules(meta: AgentMeta, check: PermissionCheck): boolean {
  if (check.category === "bash") {
    return check.unresolved.every((item) => isAllowedByPattern(item, meta.bash, true));
  }
  if (check.category === "mcp") {
    return isAllowedByPattern(check.raw, meta.mcp_tools);
  }
  if (check.category === "file") {
    return (
      isAllowedByPattern(check.absolute, meta[`files.${check.operation}`]) ||
      isAllowedByPattern(check.relative, meta[`files.${check.operation}`])
    );
  }
  return true;
}

export function expandFilePath(path: string, cwd: string): string | null {
  if (!path) return null;
  if (path === "~") return homedir();
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(cwd, path);
}

export function isRelativeToRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  if (
    relativePath !== "" &&
    (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
  ) {
    return false;
  }
  return true;
}

export async function resolvePermissionPath(
  input: string,
  cwd: string,
): Promise<{ absolute: string; relative: string }> {
  let ancestor = expandFilePath(input, cwd);
  if (!ancestor) throw new Error("Missing permission path");

  const missing: string[] = [];
  while (true) {
    try {
      const absolute = resolve(await realpath(ancestor), ...missing)
        .split(sep)
        .join("/");
      return { absolute, relative: relative(cwd, absolute).split(sep).join("/") || "." };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // An existing dangling symlink is not a missing destination we can safely authorize.
      try {
        await lstat(ancestor);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        if (dirname(ancestor) === ancestor) throw error;
        missing.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
        continue;
      }
      throw error;
    }
  }
}

// File inputs must already be physical, project-relative paths.
export async function resolvePermission(cwd: string, check: PermissionCheck, mode: AgentMode) {
  const { category, sessionId } = check;
  const [local, global, subsession] = await Promise.all([
    readRules(cwd),
    readRules(),
    findSubsession(cwd, sessionId),
  ]);

  const scopes: Array<PermissionRule | undefined> = [local[sessionId]];
  if (subsession?.pid && subsession.pid !== sessionId) {
    scopes.push(local[subsession.pid]);
  }
  scopes.push(local.project);
  scopes.push(mode === "restricted" ? getDenyRules(global) : global);

  const rules = scopes.map((schema) => getSchemaRules(category, schema));
  let permission: "deny" | "allowed" | "ask" = "ask";

  if (category === "bash") {
    const unresolved: string[] = [];
    for (const item of check.unresolved) {
      permission = findScopedPermission(rules, item, true);
      if (permission === "deny") return "deny";
      if (permission === "ask") unresolved.push(item);
    }
    check.unresolved = unresolved;
    return unresolved.length > 0 ? "ask" : "allowed";
  }
  if (category === "file") {
    const { absolute, relative, operation } = check;
    permission = findScopedPermission(rules, relative, false, operation);
    permission =
      permission === "ask" ? findScopedPermission(rules, absolute, false, operation) : permission;

    if (
      permission === "ask" &&
      (mode !== "restricted" || operation !== "write") &&
      (isRelativeToRoot(absolute, cwd) ||
        isRelativeToRoot(absolute, dirname(getPiPath("settings"))))
    ) {
      permission = "allowed";
    }
  } else {
    permission = findScopedPermission(rules, check.raw);
  }

  return permission;
}
