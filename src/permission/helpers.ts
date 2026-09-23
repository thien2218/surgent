import type { BashCommand, FileOp, PermissionCheck, PermissiveToolName } from "./types.js";
import { PERMISSIVE_TOOLS, SUSPICIOUS_BASH_PATTERNS } from "./constants.js";
import { SCOPES } from "./constants.js";
import type { Category, DisplayRule, FileAccess, Scope } from "./types.js";
import type { AgentMode } from "../agent/types.js";
import { extractBashCommands } from "./bash.js";
import { unique } from "../utils.js";
import { resolvePermissionPath } from "./resolution.js";
import { relative } from "node:path";

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
  return scope !== "global" ? `[this ${scope}]` : "[across projects]";
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
  const fileOps = ["read", "write", "deny"] as const;
  const valueIndex = fileOps.findIndex((value) => value === rule.value);
  rule.value = fileOps[(valueIndex + 1) % fileOps.length]!;
}

function getBashUncertainty(command: BashCommand): string | undefined {
  if (command.unresolved) return "Dynamic or invalid bash command";
  for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
    if (pattern.test(command.text)) return reason;
  }
}

export async function getPermissionCheck(
  cwd: string,
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<PermissionCheck | null> {
  if (!(toolName in PERMISSIVE_TOOLS)) return null;

  let fileOp: FileOp | null = null;
  const typedName = toolName as PermissiveToolName;
  const check: PermissionCheck = {
    sessionId,
    toolName: typedName,
    category: PERMISSIVE_TOOLS[typedName],
    raw: "",
    purpose: "",
    unresolved: [],
  };

  switch (typedName) {
    case "read":
      check.raw = input.path as string;
      check.purpose = `Read content from file ${check.raw}`;
      fileOp = "read";
      break;
    case "write":
    case "edit":
      check.raw = input.path as string;
      check.purpose = `Write content to file ${check.raw}`;
      fileOp = "write";
      break;
    case "grep":
      check.raw = (input.path as string | undefined) || ".";
      check.purpose = `Perform search in path ${check.raw}`;
      fileOp = "read";
      break;
    case "bash":
      check.raw = input.command as string;
      check.purpose = input.purpose as string;
      break;
    case "web_fetch":
      check.raw = input.url as string;
      check.purpose = `Fetch content from URL ${input.url}`;
      check.unresolved = [check.raw];
      break;
    case "call_mcp_tool":
      check.raw = `${(input.server as string).trim()}:${(input.tool as string).trim()}`;
      check.purpose = `Call MCP tool ${check.raw}`;
      check.unresolved = [check.raw];
      break;
  }

  if (typedName === "bash") {
    const commands = extractBashCommands(check.raw);
    const uncertainty = commands.map(getBashUncertainty).filter(Boolean);
    check.unresolved = commands.map(({ text }) => text);
    check.uncertainty = unique(uncertainty).join("; ") || undefined;
  } else if (fileOp) {
    const path = await resolvePermissionPath(check.raw, cwd);
    check.unresolved = [`${fileOp}:${relative(cwd, path) || "."}`];
  }

  return check;
}

export function cycleMode(mode: AgentMode): AgentMode {
  switch (mode) {
    case "assistant":
      return "yolo";
    case "yolo":
      return "restricted";
    case "restricted":
      return "assistant";
  }
}

export function extractOpAndPath(input: string): ["read" | "write", string] {
  const separator = input.indexOf(":");
  if (separator < 0) return ["read", input];
  return [input.slice(0, separator) === "write" ? "write" : "read", input.slice(separator + 1)];
}

export function mapToRules(
  patterns: string[],
  category: Category,
  allowed: boolean,
): Map<string, FileAccess | boolean> {
  const map = new Map<string, FileAccess | boolean>();
  for (const pattern of patterns) {
    if (category === "file") {
      const [op, path] = extractOpAndPath(pattern);
      map.set(path, allowed ? op : "deny");
    } else {
      map.set(pattern, allowed);
    }
  }
  return map;
}
