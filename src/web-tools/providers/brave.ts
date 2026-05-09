import {
  getHttpError,
  joinSnippets,
  normalizeSearchResult,
} from "../helpers.js";
import type { WebSearchMode, WebSearchResult } from "../types.js";
import { isDefined } from "../../utils.js";

interface BraveSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
  extra_snippets?: string[];
  meta_url?: {
    href?: string;
  };
}

interface BraveSearchResponse {
  news?: {
    results?: BraveSearchItem[];
  };
  web?: {
    results?: BraveSearchItem[];
  };
}

export async function searchWithBrave(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
  signal: AbortSignal | undefined,
): Promise<WebSearchResult[]> {
  const endpoint = mode === "news" ? "news/search" : "web/search";
  const searchParams = new URLSearchParams({
    count: "10",
    extra_snippets: "true",
    q: query,
  });

  const response = await fetch(
    `https://api.search.brave.com/res/v1/${endpoint}?${searchParams.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: signal ?? null,
    },
  );

  if (!response.ok) {
    throw new Error(await getHttpError(response));
  }

  const payload = (await response.json()) as BraveSearchResponse;
  const items = payload[mode]?.results ?? [];

  return items
    .map((item) =>
      normalizeSearchResult({
        description:
          item.description ?? item.snippet ?? joinSnippets(item.extra_snippets),
        title: item.title,
        url: item.url ?? item.meta_url?.href,
      }),
    )
    .filter(isDefined);
}
