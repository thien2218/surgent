import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { toCanonicalUrl } from "./helpers.js";

export function getCurrentCacheDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCacheFilePath(url: string, date = getCurrentCacheDate()): string {
  const canonicalUrl = toCanonicalUrl(url);
  const fileName = `${createHash("md5").update(canonicalUrl).digest("hex")}.md`;
  return join(homedir(), ".pi", "agent", "web-results", date, fileName);
}

export async function pruneExpiredCacheDirs(today = getCurrentCacheDate()): Promise<void> {
  const cacheRoot = join(homedir(), ".pi", "agent", "web-results");

  try {
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== today)
        .map((entry) => rm(join(cacheRoot, entry.name), { force: true, recursive: true })),
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
}

export async function readCachedContent(
  url: string,
  date = getCurrentCacheDate(),
): Promise<string | undefined> {
  try {
    return await readFile(getCacheFilePath(url, date), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function writeFetchedResult(
  url: string,
  content: string,
  date = getCurrentCacheDate(),
): Promise<void> {
  const filePath = getCacheFilePath(url, date);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
