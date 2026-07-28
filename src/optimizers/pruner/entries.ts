export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getEntryId(entry: Record<string, unknown>): string | undefined {
  const entryId = entry.id;
  if (typeof entryId !== "string" || entryId.length === 0) return;
  return entryId;
}

export function getMessage(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  if (entry.type !== "message") return;
  const message = entry.message;
  if (!isRecord(message)) return;
  return message;
}

export function getToolResultMessage(
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const message = getMessage(entry);
  if (!message || message.role !== "toolResult") return;
  if (typeof message.toolCallId !== "string" || message.toolCallId.length === 0) return;
  if (typeof message.toolName !== "string" || message.toolName.length === 0) return;
  return message;
}

export function getDetails(message: Record<string, unknown>): Record<string, unknown> | undefined {
  const details = message.details;
  if (!isRecord(details)) return;
  return details;
}

export function getRepeatIds(message: Record<string, unknown>): string[] | undefined {
  const repeat = getDetails(message)?.repeat;
  if (typeof repeat === "string" && repeat.length > 0) return [repeat];
  if (!Array.isArray(repeat) || repeat.length === 0) return;

  const repeatIds: string[] = [];
  for (const repeatId of repeat) {
    if (typeof repeatId !== "string" || repeatId.length === 0) return;
    repeatIds.push(repeatId);
  }
  return repeatIds;
}

export function getParentId(entry: Record<string, unknown>): string | null {
  if (typeof entry.parentId === "string") return entry.parentId;
  return null;
}

export function getBranchEntries(
  entries: Record<string, unknown>[],
  leafId: string | null,
): Record<string, unknown>[] {
  if (!leafId) return [];

  const entriesById = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const entryId = getEntryId(entry);
    if (entryId) entriesById.set(entryId, entry);
  }
  if (!entriesById.has(leafId)) return [];

  const branch: Record<string, unknown>[] = [];
  const visitedIds = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId && !visitedIds.has(currentId)) {
    const entry = entriesById.get(currentId);
    if (!entry) break;
    visitedIds.add(currentId);
    branch.push(entry);
    currentId = getParentId(entry);
  }
  return branch.reverse();
}

export function getLastEntryId(entries: Record<string, unknown>[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entryId = getEntryId(entries[index]!);
    if (entryId) return entryId;
  }
  return null;
}
