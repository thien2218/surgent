import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { toCanonicalUrl } from "./helpers.js";
import { getPiPath } from "../../utils.js";

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
  return getPiPath("web", "global", date, fileName);
}

export async function pruneExpiredCacheDirs(today = getCurrentCacheDate()) {
  const cacheRoot = getPiPath("web");
  try {
    const entries = await readdir(cacheRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== today)
        .map((entry) => rm(join(cacheRoot, entry.name), { force: true, recursive: true })),
    );
  } catch (error) {
    if (isMissingFileError(error)) return;
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
) {
  const filePath = getCacheFilePath(url, date);
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
