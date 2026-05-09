import { isDefined, normalizeSearchResult } from "../utils.js";
import type { WebSearchMode, WebSearchResult } from "../types.js";

interface FirecrawlSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
}

interface FirecrawlSearchData {
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

interface FirecrawlSearchResponse {
  data?: FirecrawlSearchData;
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

export async function searchWithFirecrawl(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
): Promise<WebSearchResult[]> {
  const firecrawlModule = (await import("@mendable/firecrawl-js")) as {
    Firecrawl?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    FirecrawlApp?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    default?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };

  const FirecrawlClient =
    firecrawlModule.FirecrawlApp ??
    firecrawlModule.Firecrawl ??
    firecrawlModule.default;

  if (typeof FirecrawlClient !== "function") {
    throw new Error("Firecrawl SDK export was not found.");
  }

  const client = new FirecrawlClient({ apiKey });
  const response = (await client.search(query, {
    limit: 10,
    sources: [mode],
  })) as FirecrawlSearchResponse;

  const data = response.data ?? response;
  const items = mode === "news" ? (data.news ?? []) : (data.web ?? []);

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
