import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { recordExtension } from "../../helpers/extension.js";

function setup(configured: string[] = ["tavily", "brave-search", "firecrawl"]) {
  const read = vi.fn(async (provider: string) => configured.includes(provider) ? { type: "api_key", key: "fake-key" } : undefined);
  const ctx = { modelRegistry: { runtime: { credentials: { read } } } } as unknown as ExtensionContext;
  const extension = recordExtension();
  webTools(extension.api);
  return { tool: extension.tool("web_search"), ctx, read };
}
afterEach(() => vi.unstubAllGlobals());

it.each([{}, { max: 2, news: true }])("forwards trimmed queries and default or explicit options %j", async options => {
  const { tool, ctx } = setup();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ results: [{ title: "Title", url: "https://example.invalid", content: "summary" }] }));
  vi.stubGlobal("fetch", fetch);

  const result = await tool.execute("search", { query: "  query  ", ...options }, undefined, undefined, ctx);

  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({ query: "query", max_results: options.max ?? 5, topic: options.news ? "news" : "general" });
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.details.results, null, 2) }]);
  expect(result.details.results).toEqual([{ title: "Title", url: "https://example.invalid", description: "summary" }]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects blank queries before reading credentials or starting a request", async () => {
  const { tool, ctx, read } = setup();
  await expect(tool.execute("blank", { query: "  " }, undefined, undefined, ctx)).rejects.toThrow("Query must not be empty");
  expect(read).not.toHaveBeenCalled();
});
it("skips unconfigured search providers", async () => {
  const { tool, ctx } = setup(["brave-search"]);
  const fetch = vi.fn(async () => Response.json({ web: { results: [{ title: "Brave", url: "https://example.invalid" }] } }));
  vi.stubGlobal("fetch", fetch);
  const result = await tool.execute("skip", { query: "query" }, undefined, undefined, ctx);
  expect(result.details.results[0].title).toBe("Brave");
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("api.search.brave.com"), expect.any(Object));
});
it("falls through empty Tavily and failed Brave results to Firecrawl", async () => {
  const { tool, ctx } = setup();
  const fetch = vi.fn(async (input: string) => {
    if (input.includes("tavily")) return Response.json({ results: [] });
    if (input.includes("brave")) return new Response("unavailable", { status: 503 });
    return Response.json({ success: true, data: { web: [{ title: "Firecrawl", url: "https://example.invalid" }] } });
  });
  vi.stubGlobal("fetch", fetch);
  const result = await tool.execute("fallback", { query: "query" }, undefined, undefined, ctx);
  expect(result.details.results[0].title).toBe("Firecrawl");
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("provides login guidance when no search provider is configured", async () => {
  const { tool, ctx } = setup([]);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(tool.execute("missing", { query: "query" }, undefined, undefined, ctx)).rejects.toThrow("Use /web-login");
  expect(fetch).not.toHaveBeenCalled();
});
it("reports configured failures and skipped providers when search is exhausted", async () => {
  const { tool, ctx } = setup(["tavily"]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));
  await expect(tool.execute("empty", { query: "query" }, undefined, undefined, ctx)).rejects.toThrow(/Tavily: returned no results[\s\S]*Brave Search: not configured[\s\S]*Firecrawl: not configured/);
});
it("propagates credential-store failure without contacting a provider", async () => {
  const { tool, ctx, read } = setup();
  const error = new Error("credential store unavailable");
  read.mockRejectedValueOnce(error);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(tool.execute("storage", { query: "query" }, undefined, undefined, ctx)).rejects.toBe(error);
  expect(fetch).not.toHaveBeenCalled();
});
it("does not read credentials for an already-cancelled search", async () => {
  const { tool, ctx, read } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(tool.execute("cancelled", { query: "query" }, controller.signal, undefined, ctx)).rejects.toThrow("cancelled");
  expect(read).not.toHaveBeenCalled();
});

it.each(["tavily", "brave-search", "firecrawl"])("cancels an active %s search without fallback", async provider => {
  const { tool, ctx } = setup([provider]);
  const controller = new AbortController();
  const reason = new Error("test cancellation");
  onTestFinished(() => controller.abort(reason));
  const started = Promise.withResolvers<RequestInit | undefined>();
  const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
    started.resolve(init);
    if (!init?.signal) throw new Error("Missing cancellation signal");
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", fetch);
  const outcome = tool.execute("active", { query: "query" }, controller.signal, undefined, ctx)
    .then(result => result, error => error);

  expect((await started.promise)?.signal).toBe(controller.signal);
  controller.abort(reason);

  await expect(outcome).resolves.toBe(reason);
  expect(fetch).toHaveBeenCalledOnce();
});
it("does not start search after cancellation during credential lookup", async () => {
  const { tool, ctx, read } = setup();
  const controller = new AbortController();
  read.mockImplementationOnce(async () => {
    controller.abort();
    return { type: "api_key", key: "fake-key" };
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const outcome = tool.execute("lookup", { query: "query" }, controller.signal, undefined, ctx);
  await expect(outcome).rejects.toBe(controller.signal.reason);
  expect(fetch).not.toHaveBeenCalled();
});
