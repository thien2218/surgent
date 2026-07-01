import { formatErrorMessage, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type { WebFetchResponse } from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import { tavily } from "@tavily/core";
import type { WebFetchProvider, WebSearchProvider } from "./index.js";

interface TavilySearchResponse {
  results?: Array<{ title?: string; content?: string; url?: string }>;
}

interface TavilyExtractResponse {
  failedResults?: Array<{ error?: string; url: string }>;
  results?: Array<{ rawContent?: string; url: string }>;
}

export class TavilyProvider implements WebSearchProvider, WebFetchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, news: boolean, max: number): Promise<WebSearchResult[]> {
    const client = tavily({ apiKey: this.apiKey });
    const response = (await client.search(query, {
      includeAnswer: false,
      includeRawContent: false,
      maxResults: max,
      searchDepth: "basic",
      topic: news ? "news" : "general",
    })) as TavilySearchResponse;

    return (response.results ?? [])
      .map((item) =>
        normalizeSearchResult({ description: item.content, title: item.title, url: item.url }),
      )
      .filter(isDefined);
  }

  async fetch(url: string): Promise<WebFetchResponse> {
    const client = tavily({ apiKey: this.apiKey });
    try {
      const response = (await client.extract([url], {
        format: "markdown",
      })) as TavilyExtractResponse;
      const content = normalizeFetchedContent(response.results?.[0]?.rawContent);

      if (content) {
        return { provider: "tavily", content, url };
      }

      const errorMsg = response.failedResults?.[0]?.error ?? "Tavily returned no content.";
      return { provider: "tavily", url, error: errorMsg };
    } catch (error) {
      return { provider: "tavily", url, error: formatErrorMessage(error) };
    }
  }
}
