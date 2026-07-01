import { getHttpError, joinSnippets, normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import type { WebSearchProvider } from "./index.js";

interface BraveSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
  extra_snippets?: string[];
  meta_url?: { href?: string };
}

interface BraveSearchResponse {
  news?: { results?: BraveSearchItem[] };
  web?: { results?: BraveSearchItem[] };
}

export class BraveWebSearchProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, news: boolean, max: number): Promise<WebSearchResult[]> {
    const endpoint = news ? "news/search" : "web/search";
    const searchParams = new URLSearchParams({
      count: String(max),
      extra_snippets: "true",
      q: query,
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/${endpoint}?${searchParams.toString()}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
      },
    );

    if (!response.ok) {
      throw new Error(await getHttpError(response));
    }

    const payload = (await response.json()) as BraveSearchResponse;
    const items = (news ? payload.news : payload.web)?.results ?? [];

    return items
      .map((item) =>
        normalizeSearchResult({
          description: item.description ?? item.snippet ?? joinSnippets(item.extra_snippets),
          title: item.title,
          url: item.url ?? item.meta_url?.href,
        }),
      )
      .filter(isDefined);
  }
}
