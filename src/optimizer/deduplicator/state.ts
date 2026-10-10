import type { ToolCall } from "@earendil-works/pi-ai";
import type { ProjectedSessionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { normalizeToolPath } from "./resources.js";

function isPathTool(toolName: string) {
  return (
    toolName === "write" || toolName === "read" || toolName === "edit" || toolName === "inspect"
  );
}

function mapCalls(branch: SessionEntry[]) {
  const calls = new Map<string, { call: ToolCall; idx: number } | null>();
  for (const [idx, entry] of branch.entries()) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "assistant" ||
      !Array.isArray(entry.message.content)
    ) {
      continue;
    }
    for (const block of entry.message.content) {
      if (block.type !== "toolCall") continue;
      calls.set(block.id, calls.has(block.id) ? null : { call: block, idx });
    }
  }
  return calls;
}

export function buildDeduplicatorState(
  entries: ProjectedSessionEntry[],
  branch: SessionEntry[],
  cwd: string,
): Set<string> {
  const calls = mapCalls(branch);
  const eligible = new Set(
    entries.filter((entry) => getEligibleResult(entry)).map((entry) => entry.sourceEntry.id),
  );
  const inspected = new Set<string>();
  const snapshots = new Set<string>();
  const hidden = new Set<string>();

  for (let idx = branch.length - 1; idx >= 0; idx--) {
    const entry = branch[idx]!;
    if (entry.type === "compaction") break;
    if (
      entry.type !== "message" ||
      entry.message.role !== "toolResult" ||
      entry.message.isError !== false
    ) {
      continue;
    }

    const raw = entry.message;
    if (!isPathTool(raw.toolName) || !eligible.has(entry.id)) continue;

    const matched = calls.get(raw.toolCallId);
    if (!matched || matched.idx >= idx || matched.call.name !== raw.toolName) continue;

    const input = matched.call.arguments?.path;
    if (typeof input !== "string" || input.trim() === "") continue;

    let path: string;
    try {
      path = normalizeToolPath(input, cwd, raw.toolName);
    } catch {
      continue;
    }

    if (snapshots.has(path)) {
      hidden.add(entry.id);
      continue;
    }

    const fullRead =
      raw.toolName === "read" &&
      raw.details !== null &&
      typeof raw.details === "object" &&
      "fullFile" in raw.details &&
      raw.details.fullFile === true;

    if (raw.toolName === "write" || fullRead) {
      snapshots.add(path);
      continue;
    }
    if (raw.toolName !== "inspect") continue;

    const symbol = matched.call.arguments.symbol as string;
    const identity = `${path}:${symbol.trim()}`;
    if (inspected.has(identity)) hidden.add(entry.id);
    else inspected.add(identity);
  }

  return hidden;
}
