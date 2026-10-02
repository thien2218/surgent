import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { readCachedContent } from "../../../src/web-tools/web-fetch/storage.js";
import { recordExtension } from "../../helpers/extension.js";

const url = "https://example.invalid/page";

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "surgent-web-fetch-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
  const extension = recordExtension();
  webTools(extension.api);
  const read = vi.fn(async () => ({ type: "api_key", key: "fake-key" }));
  const ctx = { modelRegistry: { runtime: { credentials: { read } } } } as unknown as ExtensionContext;
  return { tool: extension.tool("web_fetch"), ctx, read };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ["native", url],
  ["jina", "https://r.jina.ai/"],
  ["firecrawl", "https://api.firecrawl.dev/"],
  ["tavily", "https://api.tavily.com/"],
])("cancels active %s request without fallback or cache writes", async (_provider, endpoint) => {
  const { tool, ctx } = await setup();
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  onTestFinished(() => controller.abort(reason));
  const started = Promise.withResolvers<RequestInit | undefined>();
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (!input.startsWith(endpoint)) return new Response("unavailable", { status: 503 });
    started.resolve(init);
    if (!init?.signal) throw new Error("Request missing cancellation signal");
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", fetch);
  const outcome = tool.execute("cancel", { url }, controller.signal, undefined, ctx)
    .then(result => ({ result }), error => ({ error }));

  const request = await started.promise;
  expect(request?.signal).toBe(controller.signal);
  const requestCount = fetch.mock.calls.length;
  controller.abort(reason);

  await expect(outcome).resolves.toMatchObject({ error: { message: expect.stringContaining(reason.message) } });
  expect(fetch).toHaveBeenCalledTimes(requestCount);
  await expect(readCachedContent(url)).resolves.toBeUndefined();
});

it("rejects a late successful response after cancellation without caching it", async () => {
  const { tool, ctx } = await setup();
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const fetch = vi.fn(() => {
    started.resolve();
    return response.promise;
  });
  vi.stubGlobal("fetch", fetch);
  const outcome = tool.execute("late", { url }, controller.signal, undefined, ctx)
    .then(result => ({ result }), error => ({ error }));

  await started.promise;
  controller.abort(reason);
  response.resolve(new Response("# Late content", { headers: { "content-type": "text/markdown" } }));

  await expect(outcome).resolves.toEqual({ error: reason });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(readCachedContent(url)).resolves.toBeUndefined();
});

it("does not start a fallback request after cancellation during credential lookup", async () => {
  const { tool, ctx, read } = await setup();
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  const started = Promise.withResolvers<void>();
  const credential = Promise.withResolvers<{ type: string; key: string }>();
  read.mockImplementationOnce(() => {
    started.resolve();
    return credential.promise;
  });
  const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const outcome = tool.execute("lookup", { url }, controller.signal, undefined, ctx)
    .then(result => ({ result }), error => ({ error }));

  await started.promise;
  controller.abort(reason);
  credential.resolve({ type: "api_key", key: "fake-key" });

  await expect(outcome).resolves.toEqual({ error: reason });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(readCachedContent(url)).resolves.toBeUndefined();
});
