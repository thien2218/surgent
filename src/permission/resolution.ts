import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AgentAllowList, AgentMeta } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { BASH_TOKEN } from "./constants.js";
import { findSubsession } from "../subsession/storage.js";
import { findScopedPermission, matchesPattern } from "./precedence.js";

export { matchesPattern, specificity } from "./precedence.js";

function getSchemaRules(
  schema: PermissionRule | undefined,
  category: Category,
): Record<string, FileAccess | boolean> {
  if (!schema) return {};
  if (category === "file") return schema.file ?? {};
  if (category === "web") return schema.web ?? {};
  return schema.bash ?? {};
}

export function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  const tokens = command.match(BASH_TOKEN) ?? [];

  for (const token of tokens) {
    const strippedToken = stripShellQuotes(token.replace(/[,;:'"]+$/, ""));
    if (!looksLikePathToken(strippedToken)) continue;
    paths.push(strippedToken);
  }

  return [...new Set(paths)];
}

function stripShellQuotes(token: string): string {
  if (token.length < 2) return token;

  const firstChar = token[0];
  const lastChar = token[token.length - 1];
  if (
    (firstChar === "'" && lastChar === "'") ||
    (firstChar === '"' && lastChar === '"') ||
    (firstChar === "`" && lastChar === "`")
  ) {
    return token.slice(1, -1);
  }

  return token;
}

function looksLikePathToken(token: string): boolean {
  if (!token || token.includes("://") || token.startsWith("-")) {
    return false;
  }

  if (
    token.startsWith("~/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("/")
  ) {
    return true;
  }
  if (token.includes("/")) {
    return true;
  }
  if (token.startsWith(".")) {
    return true;
  }

  return /\.[A-Za-z][A-Za-z0-9_-]*$/.test(token);
}

function isAllowedByPattern(raw: string, allowList?: AgentAllowList, bash?: boolean): boolean {
  return Boolean(
    allowList !== "none" &&
    (!allowList || allowList.some((pattern: string) => matchesPattern(raw, pattern, bash))),
  );
}

export function checkAgentRules(meta: AgentMeta, check: PermissionCheck): boolean {
  const { category, raw } = check;
  if (category === "bash") {
    return isAllowedByPattern(raw, meta.bash, true);
  }
  if (category === "file") {
    return isAllowedByPattern(raw, meta[check.op === "write" ? "files.write" : "files.read"]);
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

export async function resolvePermission(
  cwd: string,
  check: PermissionCheck,
): Promise<"allowed" | "blocked" | "ask"> {
  const { category, raw, op, sessionId } = check;
  // For bash: also check any path-like args as file reads
  if (category === "bash") {
    for (const path of extractPathsFromCommand(raw)) {
      const fileCheck = { category: "file", raw: path, op: "read", toolName: "bash" } as const;
      const filePermission = await resolvePermission(cwd, { ...fileCheck, sessionId });
      if (filePermission !== "allowed") return filePermission;
    }
  }

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

  const permission = findScopedPermission(
    scopes.map((schema) => getSchemaRules(schema, category)),
    raw,
    category === "bash",
    op,
  );
  if (permission) return permission;

  if (category === "file") {
    const inAllowedDir = Boolean(
      getRelativePathInRoot(raw, cwd) || getRelativePathInRoot(raw, dirname(getPiPath("settings"))),
    );
    return inAllowedDir ? "allowed" : "ask";
  }

  return "ask";
}
