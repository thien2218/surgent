import { isAbsolute, relative, resolve } from "node:path";
import pm from "picomatch";
import type { AgentMeta } from "../agents/types.js";
import { loadAgents } from "../agents/storage.js";
import { getActiveAgent } from "../agents/states.js";
import { readGlobal, readLocal } from "./storage.js";
import type { Category, FileAccess, PermissionRule, PermissionCheck } from "./types.js";

const GLOB_CHARS = /[*?[\]{}]/;
const PATH_IN_COMMAND = /(?:^|\s)((?:\/|\.\.?\/|~\/)[^\s;|&><'"]*)/g;

function specificity(pattern: string): number {
  return GLOB_CHARS.test(pattern) ? pattern.length : Infinity;
}

export function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === key) return true;
  if (!GLOB_CHARS.test(pattern)) return false;

  try {
    return pm(pattern, { dot: true })(key);
  } catch {
    return false;
  }
}

function findBestMatch(
  rules: Record<string, FileAccess | boolean>,
  key: string,
): boolean | FileAccess | undefined {
  let best: { value: FileAccess | boolean; score: number } | null = null;

  for (const [pattern, value] of Object.entries(rules)) {
    if (!matchesPattern(key, pattern)) continue;
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
    const p = match[1]!.replace(/[,;:'"]+$/, ""); // strip trailing punctuation
    if (p) paths.push(p);
  }
  return [...new Set(paths)]; // dedup
}

function checkAgentRules(agentMeta: AgentMeta | null, check: PermissionCheck): boolean {
  if (!agentMeta) return true;
  const { category, raw } = check;

  if (category === "bash" && agentMeta.bash) {
    return agentMeta.bash.some((pattern) => matchesPattern(raw, pattern));
  }
  if (category === "file" && agentMeta.files) {
    return agentMeta.files.some((pattern) => matchesPattern(raw, pattern));
  }
  return true;
}

function isWithinCwd(rawPath: string, cwd: string): boolean {
  if (!rawPath || rawPath.startsWith("~/")) return false;
  const resolvedPath = resolve(cwd, rawPath);
  const relativePath = relative(cwd, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function resolvePermission(
  cwd: string,
  sessionId: string,
  check: PermissionCheck,
): Promise<boolean> {
  const agents = await loadAgents(cwd);
  const name = getActiveAgent();
  const agentMeta = agents.find((a) => a.meta.name === name)?.meta ?? null;
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
      if (!(await resolvePermission(cwd, sessionId, fileCheck))) return false;
    }
  }

  // Scope rules: always (global) > project > session — first match wins
  const [local, global] = await Promise.all([readLocal(cwd), readGlobal()]);
  const scopes = [global, local.project, local[sessionId]];

  for (const schema of scopes) {
    const rules = getSchemaRules(schema, category);
    const match = findBestMatch(rules, raw);
    if (typeof match === "undefined") continue;

    if (category === "file") {
      if (match === "write") return true;
      return op === match;
    } else {
      return match as boolean;
    }
  }

  if (category === "file") {
    return isWithinCwd(raw, cwd); // Default: allow within cwd, even for relative tool inputs
  }

  return false;
}
