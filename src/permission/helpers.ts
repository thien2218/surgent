import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { BashCommand, PermissionCheck, PermissiveToolName } from "./types.js";
import { PERMISSIVE_TOOLS, SUSPICIOUS_BASH_PATTERNS } from "./constants.js";
import { MODE_ENTRY } from "../commands/index.js";
import { SCOPES } from "./constants.js";
import type { Category, DisplayRule, FileAccess, Scope } from "./types.js";
import type { AgentMode } from "../agent/types.js";
import { extractBashCommands } from "./bash.js";
import { unique } from "../utils.js";

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

export function getRulePatternPlaceholder(category: Category): string {
  if (category === "file") {
    return "Path or glob pattern (example: src/**/*.ts)";
  }
  if (category === "web") {
    return "Host or URL pattern (example: api.example.com/**)";
  }
  if (category === "mcp") {
    return "MCP server and tool (example: github:search)";
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

function getBashUncertainty(command: BashCommand): string | undefined {
  if (command.unresolved) return "Dynamic or invalid bash command";
  for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
    if (pattern.test(command.text)) return reason;
  }
}

export function getPermissionCheck(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
): PermissionCheck | null {
  if (!(toolName in PERMISSIVE_TOOLS)) return null;
  const typedName = toolName as PermissiveToolName;
  let purpose: string;
  let raw: string;
  let mcpServer: string | undefined;

  switch (typedName) {
    case "read":
    case "write":
    case "edit":
      raw = input.path as string;
      purpose = `Access to file ${input.path}`;
      break;
    case "grep":
      raw = (input.path as string | undefined) ?? ".";
      purpose = `Search files in ${raw}`;
      break;
    case "bash":
      raw = input.command as string;
      purpose = input.purpose as string;
      break;
    case "web_fetch":
      raw = input.url as string;
      purpose = `Fetch content from URL ${input.url}`;
      break;
    case "call_mcp_tool":
      mcpServer = (input.server as string).trim();
      raw = `${mcpServer}:${(input.tool as string).trim()}`;
      purpose = `Call MCP tool ${raw}`;
      break;
  }

  const check: PermissionCheck = {
    sessionId,
    toolName: typedName,
    ...PERMISSIVE_TOOLS[typedName],
    raw,
    purpose,
    extracted: [raw],
    mcpServer,
  };

  if (typedName === "bash") {
    const commands = extractBashCommands(raw);
    const uncertainty = commands.map(getBashUncertainty).filter(Boolean);
    check.extracted = commands.map(({ text }) => text);
    check.uncertainty = unique(uncertainty).join("; ") || undefined;
  }

  return check;
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

export function cycleMode(mode: AgentMode): AgentMode {
  switch (mode) {
    case "yolo":
      return "assistant";
    case "assistant":
      return "yolo";
  }
}
