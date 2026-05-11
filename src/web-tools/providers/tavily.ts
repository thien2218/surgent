import { normalizeFetchedContent, toCanonicalUrl } from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchMode, WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import { tavily } from "@tavily/core";

interface TavilySearchResponse {
  results?: Array<{ title?: string; content?: string; url?: string }>;
}

interface TavilyExtractResponse {
  failedResults?: Array<{ error?: string; url: string }>;
  results?: Array<{ rawContent?: string; url: string }>;
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
      normalizeSearchResult({ description: item.content, title: item.title, url: item.url }),
    )
    .filter(isDefined);
}

export async function fetchWithTavily(
  apiKey: string,
  urls: string[],
): Promise<WebFetchProviderResponse> {
  const client = tavily({ apiKey });
  const response = (await client.extract(urls, {
    format: "markdown",
  })) as TavilyExtractResponse;
  const resultByUrl = new Map((response.results ?? []).map((item) => [item.url, item] as const));
  const failedByUrl = new Map(
    (response.failedResults ?? []).map(
      (item) => [item.url, item.error ?? "Tavily extract failed."] as const,
    ),
  );
  const results: WebFetchResult[] = [];
  const failures: WebFetchFailure[] = [];

  for (const url of urls) {
    const canonicalUrl = toCanonicalUrl(url);
    const item = resultByUrl.get(canonicalUrl);
    const content = normalizeFetchedContent(item?.rawContent);

    if (content) {
      results.push({ content, provider: "tavily", url });
      continue;
    }

    failures.push({
      message: failedByUrl.get(canonicalUrl) ?? "Tavily returned no content.",
      provider: "tavily",
      url,
    });
  }

  return { failures, results };
}
