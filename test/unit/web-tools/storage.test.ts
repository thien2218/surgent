import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { getPiPath } from "../../../src/utils.js";
import { getCacheFilePath, getCurrentCacheDate, pruneExpiredCacheDirs, readCachedContent, writeFetchedResult } from "../../../src/web-tools/web-fetch/storage.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), writeFile: vi.fn(actual.writeFile) };
});
const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const url = "https://example.invalid/page";
const date = "2026-04-03";

beforeEach(async () => {
  const home = await filesystem.mkdtemp(join(tmpdir(), "surgent-web-storage-"));
  onTestFinished(() => filesystem.rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
});
afterEach(() => {
  vi.mocked(mkdir).mockReset().mockImplementation(filesystem.mkdir);
  vi.mocked(writeFile).mockReset().mockImplementation(filesystem.writeFile);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("uses canonical URL identity while keeping query variants separate", () => {
  expect(getCacheFilePath(" HTTPS://EXAMPLE.INVALID:443 ", date)).toBe(getCacheFilePath("https://example.invalid/", date));
  expect(getCacheFilePath(`${url}?page=1`, date)).not.toBe(getCacheFilePath(`${url}?page=2`, date));
});

it("uses the local calendar date with padded month and day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 3, 3, 12));
  expect(getCurrentCacheDate()).toBe(date);
});

it("distinguishes a cache miss from an empty cached document", async () => {
  await expect(readCachedContent(url, date)).resolves.toBeUndefined();
  await writeFetchedResult(url, "", date);
  await expect(readCachedContent(url, date)).resolves.toBe("");
});

it("atomically replaces cached content without leaving staging files", async () => {
  await writeFetchedResult(url, "old", date);
  await writeFetchedResult(url, "new", date);
  await expect(readCachedContent(url, date)).resolves.toBe("new");
  expect(await readdir(dirname(getCacheFilePath(url, date)))).toEqual([getCacheFilePath(url, date).split("/").at(-1)]);
});

it("propagates non-missing cache read errors", async () => {
  await mkdir(getPiPath("web"), { recursive: true });
  await writeFile(join(getPiPath("web"), date), "not a directory");
  await expect(readCachedContent(url, date)).rejects.toMatchObject({ code: "ENOTDIR" });
});

it("prunes non-current directories but preserves current cache and root files", async () => {
  await expect(pruneExpiredCacheDirs(date)).resolves.toBeUndefined();
  await writeFetchedResult(url, "old", "2026-04-02");
  await writeFetchedResult(url, "current", date);
  await mkdir(join(getPiPath("web"), "unrecognized"));
  await writeFile(join(getPiPath("web"), "keep.txt"), "keep");

  await pruneExpiredCacheDirs(date);

  expect((await readdir(getPiPath("web"))).sort()).toEqual([date, "keep.txt"]);
  await expect(readCachedContent(url, date)).resolves.toBe("current");
});

it("rejects pre-cancelled writes without creating a cache directory", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(writeFetchedResult(url, "new", date, controller.signal)).rejects.toBe(controller.signal.reason);
  expect(mkdir).not.toHaveBeenCalled();
});

it("does not start writing after cancellation during directory creation", async () => {
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  vi.mocked(mkdir).mockImplementationOnce(async (...args) => {
    const result = await filesystem.mkdir(...args);
    controller.abort(reason);
    return result;
  });

  await expect(writeFetchedResult(url, "new", date, controller.signal)).rejects.toBe(reason);
  expect(writeFile).not.toHaveBeenCalled();
  await expect(readCachedContent(url, date)).resolves.toBeUndefined();
});

it.each([false, true])("discards a cancelled staged write and preserves existing cache: %s", async existing => {
  if (existing) await writeFetchedResult(url, "old", date);
  const controller = new AbortController();
  const written = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  onTestFinished(() => release.resolve());
  vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
    await filesystem.writeFile(...args);
    written.resolve();
    await release.promise;
  });
  const outcome = writeFetchedResult(url, "cancelled", date, controller.signal)
    .then(() => undefined, error => error);

  await written.promise;
  controller.abort();
  release.resolve();

  await expect(outcome).resolves.toBe(controller.signal.reason);
  await expect(readCachedContent(url, date)).resolves.toBe(existing ? "old" : undefined);
  const entries = await readdir(dirname(getCacheFilePath(url, date)));
  expect(entries.some(entry => entry.endsWith(".tmp"))).toBe(false);
});

it("cleans up a partial failed write without replacing saved content", async () => {
  await writeFetchedResult(url, "old", date);
  const failure = new Error("disk full");
  vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
    await filesystem.writeFile(...args);
    throw failure;
  });

  await expect(writeFetchedResult(url, "partial", date)).rejects.toBe(failure);
  await expect(readFile(getCacheFilePath(url, date), "utf8")).resolves.toBe("old");
  expect((await readdir(dirname(getCacheFilePath(url, date)))).some(entry => entry.endsWith(".tmp"))).toBe(false);
});
