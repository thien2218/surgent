import { formatErrorMessage, getHttpError, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type { WebFetchResponse } from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import type { WebFetchProvider, WebSearchProvider } from "./index.js";

interface FirecrawlSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
}

interface FirecrawlSearchResponse {
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

interface FirecrawlDocument {
  markdown?: string;
  metadata?: { sourceURL?: string; ogUrl?: string };
}

export class FirecrawlProvider implements WebSearchProvider, WebFetchProvider {
  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    news: boolean,
    max: number,
    signal?: AbortSignal,
  ): Promise<WebSearchResult[]> {
    const source = news ? "news" : "web";
    // The SDK does not expose request cancellation.
    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: max, sources: [source] }),
    });
    if (!response.ok) {
      throw new Error(await getHttpError(response));
    }

    const payload = (await response.json()) as {
      success?: boolean;
      error?: string;
      data?: FirecrawlSearchResponse;
    };
    if (payload.success === false) {
      throw new Error(payload.error ?? "Firecrawl search failed.");
    }

    const items = news ? (payload.data?.news ?? []) : (payload.data?.web ?? []);
    return items
      .map((item) =>
        normalizeSearchResult({
          description: item.description ?? item.snippet,
          title: item.title,
          url: item.url,
        }),
      )
      .filter(isDefined);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<WebFetchResponse> {
    try {
      // The SDK does not expose request cancellation.
      const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown", "html"] }),
      });
      if (!response.ok) {
        throw new Error(await getHttpError(response));
      }
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: FirecrawlDocument;
      };
      if (payload.success === false) {
        throw new Error(payload.error ?? "Firecrawl scrape failed.");
      }

      const content = normalizeFetchedContent(payload.data?.markdown);
      if (!content) {
        return { provider: "firecrawl", url, error: "Firecrawl returned no markdown content." };
      }

      return { provider: "firecrawl", content, url };
    } catch (error) {
      return { provider: "firecrawl", url, error: formatErrorMessage(error) };
    }
  }
}
