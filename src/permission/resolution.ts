import { homedir, tmpdir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentMeta, AgentMode } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, PermissionCheck, FileCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { findFilePermission, findPermission, isDeny, matchesPattern } from "./precedence.js";
import type { AppState } from "../state.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolvePiIgnorePathBlock } from "./piignore.js";

function isAllowedByPattern(raw: string, allowList?: string[], bash?: boolean): boolean {
  return Boolean(!allowList || allowList.some((pattern) => matchesPattern(raw, pattern, bash)));
}

function normalizePath(cwd: string, absolute: string) {
  return {
    absolute: absolute.split(sep).join("/"),
    relative: relative(cwd, absolute).split(sep).join("/") || ".",
  };
}

async function loadPermissionRules(
  cwd: string,
  sessionId: string,
  mode: AgentMode,
  category: Category,
) {
  const rules: Record<string, any>[] = [];
  const [local, global] = await Promise.all([readRules(cwd), readRules()]);
  const restrictedRules = Object.entries(global[category] ?? {}).filter(
    ([, access]) => mode !== "restricted" || access === false || access === "deny",
  );

  rules.push(local[sessionId]?.[category] ?? {});
  rules.push(local.project?.[category] ?? {});
  rules.push(Object.fromEntries(restrictedRules));
  return rules;
}

function isInAllowedDir(cwd: string, path: string) {
  return (
    isRelativeToRoot(path, cwd) ||
    isRelativeToRoot(path, dirname(getPiPath("settings"))) ||
    isRelativeToRoot(path, tmpdir())
  );
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
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
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
      return normalizePath(cwd, resolve(await realpath(ancestor), ...missing));
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

export async function resolvePermission(cwd: string, check: PermissionCheck, mode: AgentMode) {
  const { category, sessionId } = check;
  const rules = await loadPermissionRules(cwd, sessionId, mode, category);

  if (category === "bash") {
    const unresolved: string[] = [];
    for (const item of check.unresolved) {
      const permission = findPermission(rules, item, true);
      if (isDeny(permission)) return permission;
      if (permission === "ask") unresolved.push(item);
    }
    check.unresolved = unresolved;
    return unresolved.length > 0 ? "ask" : "allowed";
  }

  // File inputs must already be physical, project-relative paths.
  if (category === "file") {
    const { operation } = check;
    const permission = findFilePermission(rules, check, operation);
    if (
      permission === "ask" &&
      (mode !== "restricted" || operation !== "write") &&
      isInAllowedDir(cwd, check.absolute)
    ) {
      return "allowed";
    }
    return permission;
  }

  return findPermission(rules, check.raw);
}

export async function resolveReadGrant(path: string, state: AppState, ctx: ExtensionContext) {
  const denied: string[] = [];
  const { meta } = state.getAgent();
  const mode = state.getMode();
  const sessionId = state.pid ?? ctx.sessionManager.getSessionId();
  const normalized = await resolvePermissionPath(path, ctx.cwd);
  const outside = !isInAllowedDir(ctx.cwd, normalized.absolute);
  const rules = await loadPermissionRules(ctx.cwd, sessionId, mode, "file");
  const ignored = await resolvePiIgnorePathBlock(ctx.cwd, path);
  const permission = findFilePermission(rules, normalized, "read");
  const check: FileCheck = {
    raw: "",
    sessionId,
    toolName: "read",
    category: "file",
    operation: "read",
    uncertainty: "Outside-root read access",
    purpose: "Allow reading files from outside project directory?",
    ...normalized,
  };

  if (ignored) denied.push(ignored);
  if (!checkAgentRules(meta, check)) denied.push("agent files.read scope");
  if (isDeny(permission)) denied.push(permission);
  return {
    check: outside && denied.length === 0 && permission !== "allowed" ? check : null,
    denied,
  };
}
