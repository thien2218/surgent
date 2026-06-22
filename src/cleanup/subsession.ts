import { unlink } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subsession/types.js";
import { getPiPath, isMissingFileError, readJson, writeJson } from "../utils.js";

function collectDeletedParentSessionIds(
  store: StoredSubsessions,
  sessionIds: Set<string>,
): string[] {
  const deletedParentSessionIds: string[] = [];
  for (const parentSessionId of Object.keys(store)) {
    if (sessionIds.has(parentSessionId)) {
      continue;
    }
    deletedParentSessionIds.push(parentSessionId);
  }
  return deletedParentSessionIds;
}

function collectSubsessionIds(store: StoredSubsessions, parentSessionIds: string[]): Set<string> {
  const subsessionIds = new Set<string>();
  for (const parentSessionId of parentSessionIds) {
    const subsessions = store[parentSessionId] ?? {};
    for (const subsessionId of Object.keys(subsessions)) {
      subsessionIds.add(subsessionId);
    }
  }
  return subsessionIds;
}

async function deleteSessionFilesByIds(cwd: string, sessionIds: Set<string>): Promise<void> {
  if (sessionIds.size === 0) {
    return;
  }

  const sessions = await SessionManager.list(cwd, getPiPath("subsessionsDir"));
  const sessionPaths = sessions
    .filter((session) => sessionIds.has(session.id))
    .map((session) => session.path);

  for (const sessionPath of sessionPaths) {
    try {
      await unlink(sessionPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
  }
}

export async function cleanupSubsessions(cwd: string, sessionIds: Set<string>): Promise<void> {
  const storeFilePath = getPiPath("subsessions", cwd);
  const store = await readJson<StoredSubsessions>(storeFilePath, {});

  const deletedParentSessionIds = collectDeletedParentSessionIds(store, sessionIds);
  if (deletedParentSessionIds.length === 0) {
    return;
  }

  const subsessionIdsToDelete = collectSubsessionIds(store, deletedParentSessionIds);
  await deleteSessionFilesByIds(cwd, subsessionIdsToDelete);

  for (const parentSessionId of deletedParentSessionIds) {
    delete store[parentSessionId];
  }

  await writeJson(storeFilePath, store);
}
