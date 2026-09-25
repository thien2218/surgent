import { homedir, tmpdir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentMeta, AgentMode } from "../agent/types.js";
import { readRules } from "./storage.js";
import type { Category, PermissionCheck, FileCheck } from "./types.js";
import { getPiPath } from "../utils.js";
import { findSubsession } from "../subagent/storage.js";
import { findFilePermission, findPermission, isDeny, matchesPattern } from "./precedence.js";
import { getState } from "../state.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  const [local, global, subsession] = await Promise.all([
    readRules(cwd),
    readRules(),
    findSubsession(cwd, sessionId),
  ]);
  const restrictedRules = Object.entries(global[category] ?? {}).filter(
    ([, access]) => mode !== "restricted" || access === false || access === "deny",
  );

  rules.push(local[sessionId]?.[category] ?? {});
  if (subsession?.pid && subsession.pid !== sessionId) {
    rules.push(local[subsession.pid]?.[category] ?? {});
  }
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

// File inputs must already be physical, project-relative paths.
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

  if (category === "file") {
    const { operation } = check;
    const permission = findFilePermission(rules, check, operation);
    if (
      permission === "ask" &&
      (mode !== "restricted" || operation !== "write") &&
      isInAllowedDir(cwd, check.relative)
    ) {
      return "allowed";
    }
    return permission;
  }

  return findPermission(rules, check.raw);
}

export async function resolveGrepGrant(path: string, pi: ExtensionAPI, ctx: ExtensionContext) {
  const denied: string[] = [];
  const state = getState(pi);
  const { meta } = state.getAgent();
  const sessionId = ctx.sessionManager.getSessionId();
  const normalized = normalizePath(ctx.cwd, path);
  const outside = !isInAllowedDir(ctx.cwd, path);
  const rules = await loadPermissionRules(ctx.cwd, sessionId, state.getMode(), "file");
  const ignored = await resolvePiIgnorePathBlock(ctx.cwd, path);
  const permission = findFilePermission(rules, normalized, "read");

  let check: FileCheck | null = outside
    ? {
        raw: "",
        sessionId,
        toolName: "read",
        category: "file",
        operation: "read",
        uncertainty: "Outside-root grep access",
        purpose: "",
        ...normalized,
      }
    : null;

  if (ignored) denied.push(ignored);
  if (check && !checkAgentRules(meta, check)) denied.push("agent files.read scope");
  if (isDeny(permission)) denied.push(permission);
  else if (permission === "allowed") check = null;
  return { check, denied };
}
