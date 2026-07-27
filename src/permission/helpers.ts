import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PermissionCheck, PermissiveToolName } from "./types.js";
import { PERMISSIVE_TOOLS, SUSPICIOUS_BASH_PATTERNS } from "./constants.js";
import { MODE_ENTRY } from "../commands/index.js";
import { SCOPES } from "./constants.js";
import type { Category, DisplayRule, FileAccess, Scope } from "./types.js";
import type { AgentMode } from "../agent/types.js";

function getRuleValueLabel(value: FileAccess | boolean): string {
  if (typeof value === "boolean") {
    return value ? "allowed" : "disallowed";
  }
  if (value === "read") {
    return "read only";
  }
  if (value === "write") {
    return "full access";
  }
  return value;
}

export function getScopeLabel(scope: Scope) {
  return scope !== "always" ? `[this ${scope}]` : `[${scope}]`;
}

export function formatRuleOptionLabel(scope: Scope, value: FileAccess | boolean): string {
  return `${getScopeLabel(scope)} ${getRuleValueLabel(value)}`;
}

export function getRuleExprPlaceholder(category: Category): string {
  if (category === "file") {
    return "Path or glob pattern (example: src/**/*.ts)";
  }
  if (category === "web") {
    return "Host or URL pattern (example: api.example.com/**)";
  }
  return "Command pattern (example: git * or pnpm test)";
}

export function cycleRuleScope(rule: DisplayRule) {
  const scopeIndex = SCOPES.indexOf(rule.scope);
  rule.scope = SCOPES[(scopeIndex + 1) % SCOPES.length]!;
}

export function cycleRuleValue(rule: DisplayRule) {
  if (typeof rule.value === "boolean") {
    rule.value = !rule.value;
    return;
  }
  const fileOps = ["read", "write", "blocked"] as const;
  const valueIndex = fileOps.findIndex((value) => value === rule.value);
  rule.value = fileOps[(valueIndex + 1) % fileOps.length]!;
}

export function getPermissionCheck(
  toolName: string,
  input: Record<string, unknown>,
): PermissionCheck | null {
  if (!(toolName in PERMISSIVE_TOOLS)) return null;
  const typedName = toolName as PermissiveToolName;
  let danger: string | undefined;
  let raw: string;

  switch (typedName) {
    case "read":
    case "write":
    case "edit":
      raw = input.path as string;
      break;
    case "bash":
      raw = input.command as string;
      break;
    case "web_fetch":
      raw = input.url as string;
      break;
  }

  if (typedName === "bash") {
    for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
      if (pattern.test(raw)) danger = reason;
    }
  }

  return { sessionId: "", toolName: typedName, ...PERMISSIVE_TOOLS[typedName], danger, raw };
}

export function findRecentModeOverride(entries: SessionEntry[]): AgentMode | null {
  const startIndex = Math.max(0, entries.length - 5);

  for (let entryIndex = entries.length - 1; entryIndex >= startIndex; entryIndex -= 1) {
    const entry = entries[entryIndex];
    if (!entry || entry.type !== "custom" || entry.customType !== MODE_ENTRY) {
      continue;
    }
    return (entry.data as { mode: AgentMode }).mode;
  }

  return null;
}
