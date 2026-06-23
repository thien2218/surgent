import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHECKPOINT_LABEL_PREFIX } from "../checkpoint/git.js";

function parseCheckpointSessionId(stashSubject: string): string | undefined {
  if (!stashSubject.startsWith(CHECKPOINT_LABEL_PREFIX)) {
    return undefined;
  }

  const remainder = stashSubject.slice(CHECKPOINT_LABEL_PREFIX.length);
  const separatorIndex = remainder.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= remainder.length - 1) {
    return undefined;
  }

  return remainder.slice(0, separatorIndex);
}

function parseStashIndex(stashRef: string): number | undefined {
  const matches = stashRef.match(/^stash@\{(\d+)\}$/);
  if (!matches) {
    return undefined;
  }

  return Number.parseInt(matches[1]!, 10);
}

export async function cleanupCheckpointStashes(
  pi: ExtensionAPI,
  cwd: string,
  sessionIds: Set<string>,
) {
  let listResult: Awaited<ReturnType<ExtensionAPI["exec"]>>;

  try {
    listResult = await pi.exec("git", ["stash", "list", "--format=%gd%x09%gs"], { cwd });
  } catch {
    return;
  }

  if (listResult.code !== 0) return;
  const indexedStaleStashes: Array<{ stashRef: string; stashIndex: number }> = [];
  const directStaleStashRefs: string[] = [];

  for (const stashLine of listResult.stdout.split(/\r?\n/)) {
    if (!stashLine.trim()) {
      continue;
    }

    const tabIndex = stashLine.indexOf("\t");
    if (tabIndex <= 0) {
      continue;
    }

    const stashRef = stashLine.slice(0, tabIndex).trim();
    const stashSubject = stashLine.slice(tabIndex + 1).trim();
    if (!stashRef || !stashSubject.startsWith(CHECKPOINT_LABEL_PREFIX)) {
      continue;
    }

    const sessionId = parseCheckpointSessionId(stashSubject);
    if (!sessionId || sessionIds.has(sessionId)) {
      continue;
    }

    const stashIndex = parseStashIndex(stashRef);
    if (stashIndex === undefined) {
      directStaleStashRefs.push(stashRef);
      continue;
    }

    indexedStaleStashes.push({ stashRef, stashIndex });
  }

  indexedStaleStashes.sort((left, right) => right.stashIndex - left.stashIndex);

  for (const staleStash of indexedStaleStashes) {
    try {
      await pi.exec("git", ["stash", "drop", staleStash.stashRef], { cwd });
    } catch {
      continue;
    }
  }

  for (const stashRef of directStaleStashRefs) {
    try {
      await pi.exec("git", ["stash", "drop", stashRef], { cwd });
    } catch {
      continue;
    }
  }
}
