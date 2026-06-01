import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import pm from "picomatch";
import type { AgentMeta } from "../agents/types.js";
import { loadAgents } from "../agents/storage.js";
import { readGlobal, readLocal } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";
import { getPiPath } from "../utils.js";

const GLOB_CHARS = /[*?[\]{}]/;
const PATH_IN_COMMAND = /(?:^|\s)((?:\/|\.\.?\/|~\/)[^\s;|&><'"]*)/g;

function specificity(pattern: string): number {
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

function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = PATH_IN_COMMAND.exec(command)) !== null) {
    const path = match[1]!.replace(/[,;:'"]+$/, "");
    if (path) paths.push(path);
  }
  return [...new Set(paths)];
}

function checkAgentRules(agentMeta: AgentMeta | null, check: PermissionCheck): boolean {
  if (!agentMeta) return true;
  const { category, raw } = check;

  if (category === "bash" && agentMeta.bash) {
    return agentMeta.bash.some((pattern) => matchesPattern(raw, pattern, true));
  }
  if (category === "file" && agentMeta.files) {
    return agentMeta.files.some((pattern) => matchesPattern(raw, pattern));
  }
  return true;
}

function expandFilePath(rawPath: string, cwd: string): string | null {
  if (!rawPath) return null;
  if (rawPath === "~") return homedir();
  if (rawPath.startsWith("~/")) {
    return resolve(homedir(), rawPath.slice(2));
  }
  return resolve(cwd, rawPath);
}

function isInsidePath(targetPath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function fileInAllowedPath(rawPath: string, cwd: string): boolean {
  const resolvedPath = expandFilePath(rawPath, cwd);
  if (!resolvedPath) return false;

  const globalPiPath = dirname(getPiPath("settings", "global"));
  return isInsidePath(resolvedPath, cwd) || isInsidePath(resolvedPath, globalPiPath);
}

export async function resolvePermission(
  cwd: string,
  sessionId: string,
  agent: string,
  check: PermissionCheck,
): Promise<boolean> {
  const agents = await loadAgents(cwd);
  const agentMeta = agents.find((candidate) => candidate.meta.name === agent)?.meta ?? null;
  const { category, raw, op } = check;

  // Agent meta rules take priority — block immediately if not allowed
  if (!checkAgentRules(agentMeta, check)) return false;

  // For bash: also check any path-like args as file reads
  if (category === "bash") {
    for (const path of extractPathsFromCommand(raw)) {
      const fileCheck: PermissionCheck = {
        category: "file",
        raw: path,
        op: "read",
        toolName: "bash",
      };
      if (!(await resolvePermission(cwd, sessionId, agent, fileCheck))) return false;
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
    return fileInAllowedPath(raw, cwd); // Default: allow within cwd and global .pi path
  }

  return false;
}
