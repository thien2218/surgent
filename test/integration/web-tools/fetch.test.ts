import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { getPiPath } from "../../../src/utils.js";
import { getCacheFilePath, readCachedContent } from "../../../src/web-tools/web-fetch/storage.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup(handler: RequestListener) {
  const home = await mkdtemp(join(tmpdir(), "surgent-web-http-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
  const server = createServer(handler);
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback address");
  const url = `http://127.0.0.1:${address.port}/page`;
  const nativeFetch = globalThis.fetch;
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    if (String(input) !== url) throw new Error("Unexpected non-loopback request");
    return nativeFetch(input, init);
  });
  vi.stubGlobal("fetch", fetch);
  const ctx = { modelRegistry: { runtime: { credentials: { read: async () => undefined } } } } as unknown as ExtensionContext;
  const extension = recordExtension();
  webTools(extension.api);
  return { url, tool: extension.tool("web_fetch"), ctx, fetch };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("persists converted content and reuses it after extension re-registration", async () => {
  let requests = 0;
  const { url, tool, ctx } = await setup((_request, response) => {
    requests += 1;
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<h3>Heading</h3><p>Body.</p>");
  });

  const result = await tool.execute("first", { url }, undefined, undefined, ctx);

  await expect(readFile(getCacheFilePath(url), "utf8")).resolves.toBe("### Heading\n\nBody.");
  expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(`Output path: ${getCacheFilePath(url)}`) }]);
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining("### Heading (L1-3)") });
  const next = recordExtension();
  webTools(next.api);
  const cached = await next.tool("web_fetch").execute("cached", { url }, undefined, undefined, ctx);
  expect(cached.details.content).toBe("### Heading\n\nBody.");
  expect(requests).toBe(1);
});

it("prunes yesterday's cache and fetches fresh content after date rollover", async () => {
  let requests = 0;
  const { url, tool, ctx } = await setup((_request, response) => {
    requests += 1;
    response.writeHead(200, { "Content-Type": "text/markdown" });
    response.end(`# Revision ${requests}`);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 3, 12));
  await tool.execute("yesterday", { url }, undefined, undefined, ctx);
  vi.setSystemTime(new Date(2026, 3, 4, 12));

  const result = await tool.execute("today", { url }, undefined, undefined, ctx);

  expect(result.details.content).toBe("# Revision 2");
  expect(await readdir(getPiPath("web"))).toEqual(["2026-04-04"]);
});

it("aborts a real HTTP body stream and closes its connection without caching", async () => {
  const started = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const { url, tool, ctx, fetch } = await setup((request, response) => {
    request.socket.once("close", () => closed.resolve());
    response.writeHead(200, { "Content-Type": "text/markdown" });
    response.write("# Pending body\n");
    started.resolve();
  });
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  const outcome = tool.execute("stream", { url }, controller.signal, undefined, ctx)
    .then(result => result, error => error);

  await started.promise;
  controller.abort();

  await expect(outcome).resolves.toBe(controller.signal.reason);
  await closed.promise;
  expect(fetch).toHaveBeenCalledOnce();
  await expect(readCachedContent(url)).resolves.toBeUndefined();
});
