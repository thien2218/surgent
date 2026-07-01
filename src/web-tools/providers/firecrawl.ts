import { formatErrorMessage, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type { WebFetchResponse } from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import Firecrawl from "@mendable/firecrawl-js";
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

  async search(query: string, news: boolean, max: number): Promise<WebSearchResult[]> {
    const client = new Firecrawl({ apiKey: this.apiKey });
    const source = news ? "news" : "web";
    const response = (await client.search(query, {
      limit: max,
      sources: [source],
    })) as FirecrawlSearchResponse;
    const items = news ? (response.news ?? []) : (response.web ?? []);

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

  async fetch(url: string): Promise<WebFetchResponse> {
    const client = new Firecrawl({ apiKey: this.apiKey });
    try {
      const document = (await client.scrape(url, {
        formats: ["markdown", "html"],
      })) as FirecrawlDocument;
      const content = normalizeFetchedContent(document?.markdown);

      if (!content) {
        return { provider: "firecrawl", url, error: "Firecrawl returned no markdown content." };
      }

      return { provider: "firecrawl", content, url };
    } catch (error) {
      return { provider: "firecrawl", url, error: formatErrorMessage(error) };
    }
  }
}
