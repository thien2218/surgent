import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  formatAttempt,
  formatErrorMessage,
  formatFetchResults,
  getValidatedUrls,
} from "./helpers.js";
import { formatWebFetchSummary } from "./parser.js";
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
  description:
    "Fetch one or more public URLs, cache normalized markdown to local .md files, and return only file paths plus heading indexes.",
  promptSnippet:
    "Fetch one or more URLs, cache the page content to local markdown files, and return file paths plus heading indexes",
  promptGuidelines: [
    "Use web_fetch when the user needs the content of one or more known URLs rather than a search results list.",
    "Use web_fetch when the task depends on extracting readable page content in markdown or plain text.",
    "web_fetch returns cached file paths plus heading indexes, not full page bodies.",
    "Use read with the returned file path to inspect the content body.",
    "Use exact-match search against the returned file path when you need precise locations before reading.",
  ],
  parameters: Type.Object({
    urls: Type.Array(Type.String(), {
      description: "One or multiple HTTP(S) URLs to fetch in one call",
    }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const urls = getValidatedUrls(params.urls);
    const cacheDate = getCurrentCacheDate();
    const errors: string[] = [];
    const failtures: WebFetchFailure[] = [];
    const results: WebFetchResult[] = [];
    const nativeFetch = { name: "native", label: "Native fetch" } as const;

    await pruneExpiredCacheDirs(cacheDate);

    for (const url of urls) {
      if (signal?.aborted) {
        throw new Error("web_fetch was cancelled.");
      }

      const cachedContent = await readCachedContent(url, cacheDate);
      if (cachedContent === undefined) {
        failtures.push({ message: "Failed to fetch from cache", url });
        continue;
      }

      results.push({ provider: "native", summary: formatWebFetchSummary(cachedContent), url });
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
        errors.push(`${provider.label}: not configured`);
        continue;
      }

      try {
        const response = await webToolsFactory
          .createWebFetcher(provider.name, apiKey)
          .fetch(remaining);

        for (const result of response.results) {
          try {
            await writeFetchedResult(result.url, result.summary, cacheDate);
            results.push({ ...result, summary: formatWebFetchSummary(result.summary) });
          } catch (error) {
            failtures.push({ message: formatErrorMessage(error), url: result.url });
          }
        }

        failtures.push(...response.failures);
        errors.push(formatAttempt(provider.label, remaining.length, response));
      } catch (error) {
        errors.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    results.sort((left, right) => urls.indexOf(left.url) - urls.indexOf(right.url));

    if (results.length === 0) {
      throw new Error(`Web fetch failed for all URLs. ${errors.join(" | ")}`);
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
