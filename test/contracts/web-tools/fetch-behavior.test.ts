import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup(configured: string[] = []) {
  const home = await mkdtemp(join(tmpdir(), "surgent-web-contract-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
  const read = vi.fn(async (provider: string) => configured.includes(provider) ? { type: "api_key", key: "fake-key" } : undefined);
  const ctx = { modelRegistry: { runtime: { credentials: { read } } } } as unknown as ExtensionContext;
  const extension = recordExtension();
  webTools(extension.api);
  return { tool: extension.tool("web_fetch"), ctx, read };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["not a URL", "file:///etc/passwd", "ftp://example.invalid"])("rejects invalid URL %s without network or credentials", async url => {
  const { tool, ctx, read } = await setup();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(tool.execute("invalid", { url }, undefined, undefined, ctx)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it("does not contact providers for a pre-cancelled fetch", async () => {
  const { tool, ctx, read } = await setup();
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(tool.execute("cancelled", { url: "https://example.invalid" }, controller.signal, undefined, ctx)).rejects.toBe(controller.signal.reason);
  expect(fetch).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it("uses anonymous Jina after native fetch fails", async () => {
  const { tool, ctx } = await setup();
  const fetch = vi.fn().mockResolvedValueOnce(new Response("blocked", { status: 403 }))
    .mockResolvedValueOnce(new Response("Markdown Content:\n# Recovered"));
  vi.stubGlobal("fetch", fetch);
  const result = await tool.execute("fallback", { url: " HTTPS://EXAMPLE.INVALID:443 " }, undefined, undefined, ctx);
  expect(result.details).toEqual({ provider: "jina", url: "https://example.invalid/", content: "# Recovered" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("skips missing paid credentials and recovers using the next configured provider", async () => {
  const { tool, ctx } = await setup(["tavily"]);
  const fetch = vi.fn(async (input: string) => input.includes("api.tavily.com")
    ? Response.json({ results: [{ raw_content: "# Recovered" }] })
    : new Response("blocked", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const result = await tool.execute("paid", { url: "https://example.invalid" }, undefined, undefined, ctx);
  expect(result.details.provider).toBe("tavily");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.some(([input]) => input.includes("firecrawl"))).toBe(false);
});
it("reports exhausted providers and missing configuration", async () => {
  const { tool, ctx } = await setup();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
  await expect(tool.execute("failed", { url: "https://example.invalid" }, undefined, undefined, ctx)).rejects.toThrow(/Native fetch: HTTP 403[\s\S]*Jina: HTTP 403[\s\S]*Firecrawl: not configured[\s\S]*Tavily: not configured/);
});
it("propagates credential-store failure before contacting a fallback provider", async () => {
  const { tool, ctx, read } = await setup();
  const error = new Error("credentials unavailable");
  read.mockRejectedValueOnce(error);
  const fetch = vi.fn(async () => new Response("blocked", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  await expect(tool.execute("credentials", { url: "https://example.invalid" }, undefined, undefined, ctx)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
});
