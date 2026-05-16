import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  formatAttempt,
  formatErrorMessage,
  formatFetchResults,
  getValidatedUrls,
} from "./helpers.js";
import {
  getCurrentCacheDate,
  pruneExpiredCacheDirs,
  readCachedContent,
  writeFetchedResult,
} from "./storage.js";
import { WebToolsFactory } from "../providers/index.js";
import type { WebFetchFailure, WebFetchResult, WebFetchProviderResponse } from "./types.js";
import { WEB_FETCH_PROVIDERS } from "../settings.js";

const webToolsFactory = new WebToolsFactory();

const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description: "Fetch public URLs, cache markdown locally, return file paths and heading outline.",
  promptSnippet: "Fetch known URLs. Returns metadata and heading outline.",
  promptGuidelines: [
    "Don't use web_fetch when relevant info is already in web_search.",
    "Use web_fetch for known URLs, not discovery.",
    "Use web_fetch with all needed URLs in one call.",
    "Use web_fetch output paths with read/search only when page body is needed.",
  ],
  parameters: Type.Object({
    urls: Type.Array(Type.String(), { description: "One or multiple HTTP(S) URLs" }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const urls = getValidatedUrls(params.urls);
    const cacheDate = getCurrentCacheDate();
    const attempts: string[] = [];
    const failtures: WebFetchFailure[] = [];
    const results: WebFetchResult[] = [];
    const nativeFetch = { name: "native", label: "Native fetch" } as const;

    await pruneExpiredCacheDirs(cacheDate);

    for (const url of urls) {
      if (signal?.aborted) {
        throw new Error("web_fetch was cancelled.");
      }

      const content = await readCachedContent(url, cacheDate);
      if (content === undefined) {
        failtures.push({ message: "Failed to fetch from cache", url });
        continue;
      }

      results.push({ provider: "native", content, url });
    }

    for (const provider of [nativeFetch, ...WEB_FETCH_PROVIDERS]) {
      const remaining = failtures.map((failure) => failure.url);
      failtures.splice(0, failtures.length);

      if (remaining.length === 0) {
        break;
      }
      if (signal?.aborted) {
        throw new Error("web_fetch was cancelled.");
      }

      const apiKey = await ctx.modelRegistry.authStorage.getApiKey(provider.name, {
        includeFallback: false,
      });

      if ((provider.name === "firecrawl" || provider.name === "tavily") && !apiKey) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      try {
        const response = await webToolsFactory
          .createWebFetcher(provider.name, apiKey)
          .fetch(remaining);

        for (const result of response.results) {
          try {
            await writeFetchedResult(result.url, result.content, cacheDate);
            results.push(result);
          } catch (error) {
            failtures.push({ message: formatErrorMessage(error), url: result.url });
          }
        }

        failtures.push(...response.failures);
        attempts.push(formatAttempt(provider.label, remaining.length, response));
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    results.sort((left, right) => urls.indexOf(left.url) - urls.indexOf(right.url));

    if (results.length === 0) {
      throw new Error(`Web fetch failed for all URLs.\n|- ${attempts.join("\n|- ")}`);
    }

    return {
      content: [{ type: "text", text: formatFetchResults(results, cacheDate) }],
      details: { failures: failtures, results } satisfies WebFetchProviderResponse,
    };
  },
  renderCall(args, theme) {
    return new Text(`${theme.fg("toolTitle", "web_fetch")} [${args.urls.join(", ")}]`, 0, 0);
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Fetching content..."), 0, 0);
    }

    const details = result.details as WebFetchProviderResponse | undefined;
    const urls = details?.results.map((item) => item.url) ?? [];

    if (urls.length === 0) {
      return new Text(theme.fg("dim", "Fetched content"), 0, 0);
    }

    return new Text(`Fetched content from ${urls.join(", ")}`, 0, 0);
  },
});

export default function registerWebFetchTool(pi: ExtensionAPI) {
  pi.registerTool(webFetchTool);
}
