import { formatErrorMessage, getHttpError, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type { WebFetchResponse } from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import type { WebFetchProvider, WebSearchProvider } from "./index.js";

interface TavilySearchResponse {
  results?: Array<{ title?: string; content?: string; url?: string }>;
}

interface TavilyExtractResponse {
  failed_results?: Array<{ error?: string; url: string }>;
  results?: Array<{ raw_content?: string; url: string }>;
}

export class TavilyProvider implements WebSearchProvider, WebFetchProvider {
  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    news: boolean,
    max: number,
    signal?: AbortSignal,
  ): Promise<WebSearchResult[]> {
    // The SDK does not expose request cancellation.
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        include_answer: false,
        include_raw_content: false,
        max_results: max,
        search_depth: "basic",
        topic: news ? "news" : "general",
      }),
    });
    if (!response.ok) {
      throw new Error(await getHttpError(response));
    }

    const payload = (await response.json()) as TavilySearchResponse;
    return (payload.results ?? [])
      .map((item) =>
        normalizeSearchResult({ description: item.content, title: item.title, url: item.url }),
      )
      .filter(isDefined);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<WebFetchResponse> {
    try {
      // The SDK does not expose request cancellation.
      const response = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url], format: "markdown" }),
      });
      if (!response.ok) {
        throw new Error(await getHttpError(response));
      }

      const payload = (await response.json()) as TavilyExtractResponse;
      const content = normalizeFetchedContent(payload.results?.[0]?.raw_content);
      if (content) {
        return { provider: "tavily", content, url };
      }

      const errorMsg = payload.failed_results?.[0]?.error ?? "Tavily returned no content.";
      return { provider: "tavily", url, error: errorMsg };
    } catch (error) {
      return { provider: "tavily", url, error: formatErrorMessage(error) };
    }
  }
}
