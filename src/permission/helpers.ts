import type {
  BashToolCallEvent,
  ReadToolCallEvent,
  SessionEntry,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentMode, PermissionCheck, PermissiveToolName } from "./types.js";
import { PERMISSIVE_TOOLS, SUSPICIOUS_BASH_PATTERNS } from "./constants.js";
import { MODE_ENTRY } from "../commands/index.js";

export function getPermissionCheck(event: ToolCallEvent): PermissionCheck | null {
  if (!(event.toolName in PERMISSIVE_TOOLS)) return null;
  const toolName = event.toolName as PermissiveToolName;
  let danger: string | undefined;
  let raw: string;

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      raw = (event as ReadToolCallEvent).input.path;
      break;
    case "bash":
      raw = (event as BashToolCallEvent).input.command;
      break;
    case "web_fetch":
      raw = (event.input as Record<"url", string>).url;
      break;
  }

  if (toolName === "bash") {
    for (const { pattern, reason } of SUSPICIOUS_BASH_PATTERNS) {
      if (pattern.test(raw)) danger = reason;
    }
  }

  return { toolName, ...PERMISSIVE_TOOLS[toolName], danger, raw };
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
