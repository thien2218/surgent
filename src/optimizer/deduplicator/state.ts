import type { ToolCall } from "@earendil-works/pi-ai";
import type { ProjectedSessionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { getEligibleResult } from "../entries.js";
import { getInspectIdentity, normalizeToolPath } from "./resources.js";

export function buildDeduplicatorState(
  entries: ProjectedSessionEntry[],
  branch: SessionEntry[],
  cwd: string,
): Set<string> {
  const calls = new Map<string, { call: ToolCall; index: number } | null>();
  const eligible = new Set(entries.filter((entry) => getEligibleResult(entry)).map((entry) => entry.sourceEntry.id));
  const retained = new Set<string>();
  const writes = new Set<string>();
  const hidden = new Set<string>();

  for (const [index, entry] of branch.entries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block.type !== "toolCall") continue;
      calls.set(block.id, calls.has(block.id) ? null : { call: block, index });
    }
  }

  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]!;
    if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
    const raw = entry.message;
    if (raw.isError !== false) continue;

    let path: string | undefined;
    if (raw.toolName === "write" || raw.toolName === "read") {
      const matched = calls.get(raw.toolCallId);
      if (!matched || matched.index >= index || matched.call.name !== raw.toolName) continue;
      const input = matched.call.arguments?.path;
      if (typeof input !== "string" || input.trim() === "") continue;
      try {
        path = normalizeToolPath(input, cwd, raw.toolName);
      } catch {
        continue;
      }
      // Raw successful writes remain mutation evidence even when context edits hide them.
      if (raw.toolName === "write") {
        writes.add(path);
        continue;
      }
    }

    if (!eligible.has(entry.id)) continue;

    const inspected = raw.toolName === "inspect" ? getInspectIdentity(raw.details, cwd) : undefined;
    if (inspected) path = inspected.path;
    if (!path) continue;

    const identity = inspected && JSON.stringify([inspected.path, inspected.symbol]);
    if (writes.has(path) || (identity && retained.has(identity))) hidden.add(entry.id);
    if (identity) retained.add(identity);
  }

  return hidden;
}
