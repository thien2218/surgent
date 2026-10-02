import { afterEach, expect, it, vi } from "vitest";
import { WebToolsFactory } from "../../../src/web-tools/providers/index.js";
import { formatErrorMessage, getHttpError, joinSnippets, normalizeSearchResult } from "../../../src/web-tools/web-search/helpers.js";

afterEach(() => vi.unstubAllGlobals());

it("normalizes complete search results and rejects missing titles or URLs", () => {
  expect(normalizeSearchResult({ title: " Title ", url: " https://example.invalid ", description: " summary " }))
    .toEqual({ title: "Title", url: "https://example.invalid", description: "summary" });
  expect(normalizeSearchResult({ title: "Title", url: "https://example.invalid" })?.description).toBe("");
  expect(normalizeSearchResult({ title: " ", url: "https://example.invalid" })).toBeUndefined();
  expect(normalizeSearchResult({ title: "Title" })).toBeUndefined();
});
it("joins nonblank snippets without stringifying malformed entries", () => {
  expect(joinSnippets(["first", "", "  ", "second", null] as unknown as string[])).toBe("first second");
  expect(joinSnippets(undefined)).toBe("");
});
it("formats ordinary and non-Error failures", () => {
  expect(formatErrorMessage(new Error("offline"))).toBe("offline");
  expect(formatErrorMessage("rejected")).toBe("rejected");
  expect(formatErrorMessage(null)).toBe("null");
});
it("keeps HTTP status when the response body is blank", async () => {
  await expect(getHttpError(new Response("  ", { status: 503 }))).resolves.toBe("HTTP 503");
});

it.each([false, true])("maps Brave news=%s requests and result fallbacks", async news => {
  const items = [
    { title: " First ", url: "https://example.invalid/first", description: " description " },
    { title: "Second", meta_url: { href: "https://example.invalid/second" }, snippet: "snippet" },
    { title: "Third", url: "https://example.invalid/third", extra_snippets: ["one", "two"] },
    { title: "Missing URL" },
    { url: "https://example.invalid/no-title" },
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ [news ? "news" : "web"]: { results: items } }));
  vi.stubGlobal("fetch", fetch);

  const result = await new WebToolsFactory().createWebSearcher("brave-search", "fake-key").search("a & b", news, 3);

  const request = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(request.pathname).toBe(`/res/v1/${news ? "news" : "web"}/search`);
  expect(Object.fromEntries(request.searchParams)).toEqual({ q: "a & b", count: "3", extra_snippets: "true" });
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ "X-Subscription-Token": "fake-key" }) }));
  expect(result.map(item => item.description)).toEqual(["description", "snippet", "one two"]);
  expect(result.map(item => item.title)).toEqual(["First", "Second", "Third"]);
  expect(result[1]?.url).toBe("https://example.invalid/second");
});

it.each([false, true])("maps Firecrawl news=%s requests and selected results", async news => {
  const fetch = vi.fn(async () => Response.json({ success: true, data: {
    [news ? "news" : "web"]: [{ title: " Title ", url: "https://example.invalid", snippet: "summary" }, { title: "incomplete" }],
    [news ? "web" : "news"]: [{ title: "wrong source", url: "https://wrong.invalid" }],
  } }));
  vi.stubGlobal("fetch", fetch);

  const result = await new WebToolsFactory().createWebSearcher("firecrawl", "fake-key").search("query", news, 2);

  expect(fetch).toHaveBeenCalledWith("https://api.firecrawl.dev/v2/search", expect.objectContaining({
    method: "POST", headers: { Authorization: "Bearer fake-key", "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query", limit: 2, sources: [news ? "news" : "web"] }),
  }));
  expect(result).toEqual([{ title: "Title", url: "https://example.invalid", description: "summary" }]);
});

it.each([false, true])("maps Tavily news=%s requests and result content", async news => {
  const fetch = vi.fn(async () => Response.json({ results: [{ title: " Title ", url: "https://example.invalid", content: " summary " }, { title: "incomplete" }] }));
  vi.stubGlobal("fetch", fetch);

  const result = await new WebToolsFactory().createWebSearcher("tavily", "fake-key").search("query", news, 2);

  expect(fetch).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
    method: "POST", headers: { Authorization: "Bearer fake-key", "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query", include_answer: false, include_raw_content: false, max_results: 2, search_depth: "basic", topic: news ? "news" : "general" }),
  }));
  expect(result).toEqual([{ title: "Title", url: "https://example.invalid", description: "summary" }]);
});

it.each(["brave-search", "firecrawl", "tavily"] as const)("returns empty %s results for missing arrays", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  await expect(new WebToolsFactory().createWebSearcher(provider, "fake-key").search("query", false, 5)).resolves.toEqual([]);
});
it.each(["brave-search", "firecrawl", "tavily"] as const)("propagates %s search transport failures", async provider => {
  const error = new Error("search unavailable");
  vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
  await expect(new WebToolsFactory().createWebSearcher(provider, "fake-key").search("query", false, 5)).rejects.toBe(error);
});
it.each(["brave-search", "firecrawl", "tavily"] as const)("preserves %s HTTP status in search failures", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
  await expect(new WebToolsFactory().createWebSearcher(provider, "fake-key").search("query", false, 5)).rejects.toThrow("HTTP 429: rate limited");
});
it("propagates Firecrawl application errors instead of returning empty results", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, error: "search denied" })));
  await expect(new WebToolsFactory().createWebSearcher("firecrawl", "fake-key").search("query", false, 5)).rejects.toThrow("search denied");
});
