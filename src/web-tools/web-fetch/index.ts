import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatErrorMessage, formatFetchResult, getValidatedUrl } from "./helpers.js";
import {
  getCurrentCacheDate,
  pruneExpiredCacheDirs,
  readCachedContent,
  writeFetchedResult,
} from "./storage.js";
import { WebToolsFactory } from "../providers/index.js";
import type { WebFetchResponse } from "./types.js";
import { WEB_FETCH_PROVIDERS } from "../settings.js";

const webToolsFactory = new WebToolsFactory();

const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description: "Fetch a public URL, cache markdown locally, return file path and heading outline.",
  promptSnippet: "Fetch a known URL. Returns metadata and heading outline.",
  promptGuidelines: [
    "Don't use web_fetch when relevant info is already in web_search.",
    "Use web_fetch for known URLs, not discovery.",
    "Use web_fetch output path when page body is needed.",
    "Web content tends to be very big. Use grep to search for needed content in output first before read ",
  ],
  parameters: Type.Object({
    url: Type.String({ description: "An HTTP(S) URL" }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const url = getValidatedUrl(params.url);
    const cacheDate = getCurrentCacheDate();
    const attempts: string[] = [];
    const nativeFetch = { name: "native", label: "Native fetch" } as const;

    pruneExpiredCacheDirs(cacheDate);

    if (signal?.aborted) {
      throw new Error("web_fetch was cancelled.");
    }

    const cached = await readCachedContent(url, cacheDate);
    if (cached !== undefined) {
      const result: WebFetchResponse = { provider: "native", content: cached, url };
      return {
        content: [{ type: "text", text: formatFetchResult(result, cacheDate) }],
        details: result satisfies WebFetchResponse,
      };
    }

    for (const provider of [nativeFetch, ...WEB_FETCH_PROVIDERS]) {
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
        const response = await webToolsFactory.createWebFetcher(provider.name, apiKey).fetch(url);

        if (response.error === undefined) {
          await writeFetchedResult(url, response.content, cacheDate);
          return {
            content: [{ type: "text", text: formatFetchResult(response, cacheDate) }],
            details: response satisfies WebFetchResponse,
          };
        }

        attempts.push(`${provider.label}: ${response.error}`);
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    throw new Error(`Web fetch failed.\n|- ${attempts.join("\n|- ")}`);
  },
  renderCall(args, theme) {
    return new Text(`${theme.fg("toolTitle", "web_fetch")} [${args.url}]`, 0, 0);
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Fetching content..."), 0, 0);
    }

    const details = result.details as WebFetchResponse | undefined;

    if (!details?.url) {
      return new Text(theme.fg("dim", "Fetched content"), 0, 0);
    }

    return new Text(`Fetched content from ${details.url}`, 0, 0);
  },
});

export default webFetchTool;
