import { normalizeSearchResult } from "../helpers.js";
import type { WebSearchMode, WebSearchResult } from "../types.js";
import { isDefined } from "../../utils.js";
import { tavily } from "@tavily/core";

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
  }>;
}

export async function searchWithTavily(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
): Promise<WebSearchResult[]> {
  const client = tavily({ apiKey });
  const response = (await client.search(query, {
    includeAnswer: false,
    includeRawContent: false,
    maxResults: 10,
    searchDepth: "basic",
    topic: mode === "news" ? "news" : "general",
  })) as TavilySearchResponse;

  return (response.results ?? [])
    .map((item) =>
      normalizeSearchResult({
        description: item.content,
        title: item.title,
        url: item.url,
      }),
    )
    .filter(isDefined);
}
