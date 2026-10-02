import { afterEach, expect, it, vi } from "vitest";
import { WebToolsFactory } from "../../../src/web-tools/providers/index.js";

const url = "https://example.invalid/page";
afterEach(() => vi.unstubAllGlobals());

it("converts HTML into readable Markdown", async () => {
  const fetch = vi.fn(async () => new Response("<html><body><h3>Title</h3><p>Some <strong>text</strong>.</p></body></html>", { headers: { "content-type": "text/html" } }));
  vi.stubGlobal("fetch", fetch);
  const result = await new WebToolsFactory().createWebFetcher("native").fetch(url);
  expect(result).toEqual({ provider: "native", url, content: "### Title\n\nSome **text**." });
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ headers: { Accept: expect.stringContaining("text/html") } }));
});

it.each(["text/plain", "text/markdown", undefined])("normalizes native text with content type %s", async contentType => {
  const response = new Response(" \r\n# Title\r\nbody\r\n ");
  if (contentType) response.headers.set("content-type", contentType);
  else response.headers.delete("content-type");
  vi.stubGlobal("fetch", vi.fn(async () => response));
  await expect(new WebToolsFactory().createWebFetcher("native").fetch(url)).resolves.toMatchObject({ content: "# Title\nbody" });
});

it.each([
  { body: "binary", contentType: "application/pdf", error: "Unsupported content type" },
  { body: "   ", contentType: "text/plain", error: "empty content" },
])("rejects native content: $error", async ({ body, contentType, error }) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": contentType } })));
  const result = await new WebToolsFactory().createWebFetcher("native").fetch(url);
  expect(result).toMatchObject({ error: expect.stringContaining(error) });
  expect(result).not.toHaveProperty("content");
});

it.each([undefined, "fake-key"])("extracts Jina reader content with optional key %j", async key => {
  const fetch = vi.fn(async () => new Response("Title: Page\nURL Source: ignored\nMarkdown Content:\n # Heading\r\nbody "));
  vi.stubGlobal("fetch", fetch);
  const result = await new WebToolsFactory().createWebFetcher("jina", key).fetch(url);
  expect(result).toEqual({ provider: "jina", url, content: "# Heading\nbody" });
  expect(fetch).toHaveBeenCalledWith("https://r.jina.ai/http://example.invalid/page", expect.objectContaining({
    headers: { Accept: expect.stringContaining("text/plain"), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  }));
});

it("keeps Jina content when no reader metadata marker exists", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("# Plain Markdown")));
  await expect(new WebToolsFactory().createWebFetcher("jina").fetch(url)).resolves.toMatchObject({ content: "# Plain Markdown" });
});
it("rejects Jina metadata without extracted content", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Title: Empty\nMarkdown Content: \n")));
  await expect(new WebToolsFactory().createWebFetcher("jina").fetch(url)).resolves.toMatchObject({ error: expect.stringContaining("empty content") });
});

it.each(["native", "jina", "firecrawl", "tavily"] as const)("returns %s transport errors for fallback", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection lost"); }));
  await expect(new WebToolsFactory().createWebFetcher(provider, "fake-key").fetch(url)).resolves.toMatchObject({ error: "connection lost" });
});
it.each(["native", "jina"] as const)("returns %s HTTP status and body on rejection", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
  await expect(new WebToolsFactory().createWebFetcher(provider).fetch(url)).resolves.toMatchObject({ error: "HTTP 403: blocked" });
});
it.each(["firecrawl", "tavily"] as const)("returns %s malformed JSON as a provider failure", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON")));
  const result = await new WebToolsFactory().createWebFetcher(provider, "fake-key").fetch(url);
  expect(result).toMatchObject({ error: expect.any(String) });
  expect(result).not.toHaveProperty("content");
});
it.each(["firecrawl", "tavily"] as const)("requires a key before constructing %s fetcher", provider => {
  expect(() => new WebToolsFactory().createWebFetcher(provider)).toThrow();
});
