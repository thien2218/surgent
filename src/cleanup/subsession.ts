import { unlink } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subsession/types.js";
import { getPiPath, isMissingFileError, readJson, writeJson } from "../utils.js";

function collectOrphanedSubsessionIds(store: StoredSubsessions, pids: Set<string>): Set<string> {
  const orphanedIds = new Set<string>();
  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (!pids.has(metadata.pid)) {
      orphanedIds.add(subsessionId);
    }
  }
  return orphanedIds;
}

async function deleteSessionFilesByIds(cwd: string, sessionIds: Set<string>): Promise<void> {
  if (sessionIds.size === 0) return;
  const sessions = await SessionManager.list(cwd, getPiPath("subsessionsDir"));
  const sessionPaths = sessions
    .filter((session) => sessionIds.has(session.id))
    .map((session) => session.path);

  for (const sessionPath of sessionPaths) {
    try {
      await unlink(sessionPath);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
  }
}

export async function cleanupSubsessions(cwd: string, pids: Set<string>): Promise<void> {
  const storeFilePath = getPiPath("subsessions", cwd);
  const store = await readJson<StoredSubsessions>(storeFilePath, {});

  const orphanedIds = collectOrphanedSubsessionIds(store, pids);
  if (orphanedIds.size === 0) return;
  await deleteSessionFilesByIds(cwd, orphanedIds);

  for (const subsessionId of orphanedIds) {
    delete store[subsessionId];
  }

  await writeJson(storeFilePath, store);
}
