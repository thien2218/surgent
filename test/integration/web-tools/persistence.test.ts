import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { readCachedContent } from "../../../src/web-tools/web-fetch/storage.js";
import { recordExtension, toolCapabilities } from "../../helpers/extension.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(writeFile).mockClear(); });

it("continues provider fallback after a cache-write failure and persists the recovered content", async () => {
  const home = await mkdtemp(join(tmpdir(), "surgent-web-persistence-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("write temporarily unavailable"));
  const fetch = vi.fn().mockResolvedValueOnce(new Response("# Native"))
    .mockResolvedValueOnce(new Response("Markdown Content:\n# Recovered"));
  vi.stubGlobal("fetch", fetch);
  const ctx = { ...toolCapabilities(), modelRegistry: { runtime: { credentials: { read: async () => undefined } } } } as unknown as ExtensionToolContext;
  const extension = recordExtension();
  webTools(extension.api);
  const url = "https://example.invalid/page";

  const result = await extension.tool("web_fetch").execute("write-fallback", { url }, undefined, undefined, ctx);

  expect(result.details.provider).toBe("jina");
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(readCachedContent(url)).resolves.toBe("# Recovered");
});
