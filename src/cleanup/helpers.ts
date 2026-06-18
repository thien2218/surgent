import { readJson, writeJson } from "../utils.js";

export function pruneSessionMap(
  data: { [sessionId: string]: unknown },
  sessionIds: Set<string>,
): boolean {
  let hasChanges = false;
  for (const sessionId of Object.keys(data)) {
    if (sessionIds.has(sessionId)) {
      continue;
    }
    delete data[sessionId];
    hasChanges = true;
  }
  return hasChanges;
}

export async function pruneSessionFile(filePath: string, sessionIds: Set<string>): Promise<void> {
  const data = await readJson<{ [sessionId: string]: unknown }>(filePath, {});
  const hasChanges = pruneSessionMap(data, sessionIds);
  if (hasChanges) {
    await writeJson(filePath, data);
  }
}
