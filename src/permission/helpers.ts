import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMode, PermissionCheck, PermissiveToolName } from "./types.js";
import { PERMISSIVE_TOOLS, SUSPICIOUS_BASH_PATTERNS } from "./constants.js";
import { MODE_ENTRY } from "../commands/index.js";

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
