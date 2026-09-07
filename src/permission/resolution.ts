import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AgentAllowList, AgentMeta } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { findSubsession } from "../subagent/storage.js";
import { findScopedPermission, matchesPattern } from "./precedence.js";
import { extractOpAndPath } from "./helpers.js";

export { matchesPattern, specificity } from "./precedence.js";

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

function isAllowedByPattern(raw: string, allowList?: AgentAllowList, bash?: boolean): boolean {
  return Boolean(
    allowList !== "none" &&
    (!allowList || allowList.some((pattern: string) => matchesPattern(raw, pattern, bash))),
  );
}

export function checkAgentRules(meta: AgentMeta, check: PermissionCheck): boolean {
  const { category, extracted } = check;
  if (category === "bash") {
    return extracted.every((item) => isAllowedByPattern(item, meta.bash, true));
  }
  if (category === "file") {
    return extracted.every((item) => {
      const [op, path] = extractOpAndPath(item);
      return isAllowedByPattern(path, meta[`files.${op}`]);
    });
  }
  if (category === "mcp") {
    return extracted.every((item) => isAllowedByPattern(item, meta.mcp_tools));
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

export async function resolvePermission(cwd: string, check: PermissionCheck) {
  const { category, extracted, sessionId } = check;
  const [local, global, subsession] = await Promise.all([
    readRules(cwd),
    readRules(),
    findSubsession(cwd, sessionId),
  ]);

  const scopes: Array<PermissionRule | undefined> = [local[sessionId]];
  if (subsession?.pid && subsession.pid !== sessionId) {
    scopes.push(local[subsession.pid]);
  }
  scopes.push(local.project, global);

  const pending: string[] = [];
  for (const item of extracted) {
    const [fileOp, normalized] = category === "file" ? extractOpAndPath(item) : [undefined, item];
    let permission: "allowed" | "blocked" | "ask" | undefined = findScopedPermission(
      scopes.map((schema) => getSchemaRules(schema, category)),
      normalized,
      category === "bash",
      fileOp,
    );

    if (!permission && category === "file") {
      const inAllowedDir =
        getRelativePathInRoot(normalized, cwd) !== null ||
        getRelativePathInRoot(normalized, dirname(getPiPath("settings"))) !== null;
      permission = inAllowedDir ? "allowed" : "ask";
    }

    if (permission === "blocked") return "blocked";
    if (permission !== "allowed") pending.push(item);
  }

  return pending.length === 0 ? ("allowed" as const) : ("ask" as const);
}
