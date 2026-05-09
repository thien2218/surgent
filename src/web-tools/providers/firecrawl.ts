import { normalizeSearchResult } from "../utils.js";
import type { WebSearchMode, WebSearchResult } from "../types.js";
import { isDefined } from "../../utils.js";
import Firecrawl from "@mendable/firecrawl-js";

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
  const client = new Firecrawl({ apiKey });
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
