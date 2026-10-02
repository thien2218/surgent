import { afterEach, expect, it, vi } from "vitest";
import { WebToolsFactory } from "../../../src/web-tools/providers/index.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  {
    provider: "firecrawl" as const,
    endpoint: "https://api.firecrawl.dev/v2/scrape",
    body: { url: "https://example.invalid/page", formats: ["markdown", "html"] },
    response: { success: true, data: { markdown: " # Content\r\n " } },
  },
  {
    provider: "tavily" as const,
    endpoint: "https://api.tavily.com/extract",
    body: { urls: ["https://example.invalid/page"], format: "markdown" },
    response: { results: [{ raw_content: " # Content\r\n " }] },
  },
])("maps $provider HTTP extraction requests and responses", async ({ provider, endpoint, body, response }) => {
  const fetch = vi.fn(async () => Response.json(response));
  vi.stubGlobal("fetch", fetch);

  const result = await new WebToolsFactory().createWebFetcher(provider, "fake-key")
    .fetch("https://example.invalid/page");

  expect(fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({
    method: "POST",
    headers: { Authorization: "Bearer fake-key", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  expect(result).toEqual({ provider, url: "https://example.invalid/page", content: "# Content" });
});

it.each([
  { provider: "firecrawl" as const, response: { success: false, error: "scrape denied" }, error: "scrape denied" },
  { provider: "firecrawl" as const, response: { success: true, data: {} }, error: "no markdown content" },
  { provider: "tavily" as const, response: { failed_results: [{ error: "extract denied" }] }, error: "extract denied" },
  { provider: "tavily" as const, response: { results: [] }, error: "no content" },
])("preserves $provider extraction failure: $error", async ({ provider, response, error }) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));

  const result = await new WebToolsFactory().createWebFetcher(provider, "fake-key")
    .fetch("https://example.invalid/page");

  expect(result).toMatchObject({ provider, error: expect.stringContaining(error) });
  expect(result).not.toHaveProperty("content");
});

it.each(["firecrawl", "tavily"] as const)("preserves %s HTTP failures for fallback", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));

  const result = await new WebToolsFactory().createWebFetcher(provider, "fake-key")
    .fetch("https://example.invalid/page");

  expect(result).toMatchObject({ provider, error: "HTTP 401: denied" });
});
