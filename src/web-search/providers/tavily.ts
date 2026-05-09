import { isDefined, normalizeSearchResult } from "../utils.js";
import type { WebSearchMode, WebSearchResult } from "../types.js";

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
  const tavilyModule = (await import("@tavily/core")) as {
    tavily?: (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };

  if (typeof tavilyModule.tavily !== "function") {
    throw new Error("Tavily SDK export was not found.");
  }

  const client = tavilyModule.tavily({ apiKey });
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
