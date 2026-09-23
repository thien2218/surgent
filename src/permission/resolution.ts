import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentMeta, AgentMode } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { findSubsession } from "../subagent/storage.js";
import { findScopedPermission, matchesPattern } from "./precedence.js";
import { extractOpAndPath } from "./helpers.js";

function getSchemaRules(
  schema: PermissionRule | undefined,
  category: Category,
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
  const { category, unresolved } = check;
  if (category === "bash") {
    return unresolved.every((item) => isAllowedByPattern(item, meta.bash, true));
  }
  if (category === "file") {
    return unresolved.every((item) => {
      const [op, path] = extractOpAndPath(item);
      return isAllowedByPattern(path, meta[`files.${op}`]);
    });
  }
  if (category === "mcp") {
    return unresolved.every((item) => isAllowedByPattern(item, meta.mcp_tools));
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

export function getRelativePathInRoot(path: string, root: string): string | null {
  const resolvedPath = expandFilePath(path, root);
  if (!resolvedPath) return null;

  const relativePath = relative(root, resolvedPath);
  if (
    relativePath !== "" &&
    (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
  ) {
    return null;
  }

  return relativePath;
}

export async function resolvePermissionPath(input: string, cwd: string): Promise<string> {
  const absolute = expandFilePath(input, cwd);
  if (!absolute) throw new Error("Missing permission path");

  let ancestor = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...missing);
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
  const unresolved: string[] = [];
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

  const rules = scopes.map((schema) => getSchemaRules(schema, category));
  for (const item of check.unresolved) {
    const [fileOp, normalized] = category === "file" ? extractOpAndPath(item) : [undefined, item];
    let permission = findScopedPermission(rules, normalized, category === "bash", fileOp);

    if (
      category === "file" &&
      permission === "ask" &&
      (mode !== "restricted" || fileOp !== "write")
    ) {
      const path = resolve(cwd, normalized);
      if (
        getRelativePathInRoot(path, cwd) !== null ||
        getRelativePathInRoot(path, dirname(getPiPath("settings"))) !== null
      ) {
        permission = "allowed";
      }
    }

    if (permission === "deny") return "deny";
    if (permission === "ask") unresolved.push(item);
  }

  check.unresolved = unresolved;
  return unresolved.length > 0 ? "ask" : "allowed";
}
