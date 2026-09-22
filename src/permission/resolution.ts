import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    return null;
  }

  return relativePath;
}

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

  for (const item of check.unresolved) {
    const [fileOp, normalized] = category === "file" ? extractOpAndPath(item) : [undefined, item];
    let permission: "allowed" | "deny" | "ask" = findScopedPermission(
      scopes.map((schema) => getSchemaRules(schema, category)),
      normalized,
      category === "bash",
      fileOp,
    );

    if (
      category === "file" &&
      permission === "ask" &&
      (mode !== "restricted" || fileOp !== "write")
    ) {
      const inAllowedDir =
        getRelativePathInRoot(normalized, cwd) !== null ||
        getRelativePathInRoot(normalized, dirname(getPiPath("settings"))) !== null;
      permission = inAllowedDir ? "allowed" : "ask";
    }

    if (permission === "deny") return "deny";
    if (permission === "ask") unresolved.push(item);
  }

  check.unresolved = unresolved;
  return unresolved.length > 0 ? "ask" : "allowed";
}
