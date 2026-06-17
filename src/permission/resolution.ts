import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import pm from "picomatch";
import type { AgentAllowList, AgentMeta } from "../agent/types.js";
import { readGlobal, readLocal } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { BASH_TOKEN } from "./constants.js";

const GLOB_CHARS = /[*?[\]{}]/;

export function specificity(pattern: string): number {
  return GLOB_CHARS.test(pattern) ? pattern.length : Infinity;
}

export function matchesPattern(input: string, pattern: string, bash = false): boolean {
  if (pattern === input) return true;
  if (!GLOB_CHARS.test(pattern)) return false;

  try {
    return pm(pattern, { dot: true, bash })(input);
  } catch {
    return false;
  }
}

function findBestMatch(
  rules: Record<string, FileAccess | boolean>,
  input: string,
  bash = false,
): boolean | FileAccess | undefined {
  let best: { value: FileAccess | boolean; score: number } | null = null;

  for (const [pattern, value] of Object.entries(rules)) {
    if (!matchesPattern(input, pattern, bash)) continue;
    const score = specificity(pattern);

    if (best === null || score > best.score) {
      best = { value, score };
    }
  }

  return best?.value;
}

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

function isAllowedByPattern(
  raw: string,
  allowList: AgentAllowList | undefined,
  bash?: boolean,
): boolean {
  return Boolean(
    allowList !== "none" &&
    (!allowList || allowList.some((pattern: string) => matchesPattern(raw, pattern, bash))),
  );
}

export function checkAgentRules(agentMeta: AgentMeta, check: PermissionCheck): boolean {
  const { category, raw } = check;
  if (category === "bash") {
    return isAllowedByPattern(raw, agentMeta.bash, true);
  }
  if (category === "file") {
    return isAllowedByPattern(raw, agentMeta.files);
  }
  return true;
}

export function expandFilePath(rawPath: string, cwd: string): string | null {
  if (!rawPath) return null;
  if (rawPath === "~") return homedir();
  if (rawPath.startsWith("~/")) {
    return resolve(homedir(), rawPath.slice(2));
  }
  return resolve(cwd, rawPath);
}

export function getRelativePathInRoot(rawPath: string, rootPath: string): string | null {
  const resolvedPath = expandFilePath(rawPath, rootPath);
  if (!resolvedPath) return null;

  const relativePath = relative(rootPath, resolvedPath);
  if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    return null;
  }

  return relativePath;
}

export async function resolvePermission(
  cwd: string,
  sessionId: string,
  check: PermissionCheck,
): Promise<boolean> {
  const { category, raw, op } = check;
  // For bash: also check any path-like args as file reads
  if (category === "bash") {
    for (const path of extractPathsFromCommand(raw)) {
      const fileCheck = { category: "file", raw: path, op: "read", toolName: "bash" } as const;
      if (!(await resolvePermission(cwd, sessionId, fileCheck))) return false;
    }
  }

  // Scope rules: always (global) > project > session — first match wins
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);
  const scopes = [global, local.project, local[sessionId]];

  for (const schema of scopes) {
    const rules = getSchemaRules(schema, category);
    const match = findBestMatch(rules, raw, category === "bash");

    if (typeof match === "undefined") continue;
    if (category === "file") {
      if (match === "write") return true;
      return op === match;
    }
    return match as boolean;
  }

  if (category === "file") {
    const globalPiPath = dirname(getPiPath("settings", "global"));
    return Boolean(getRelativePathInRoot(raw, cwd) || getRelativePathInRoot(raw, globalPiPath));
  }

  return false;
}
