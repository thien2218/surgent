import { WEB_SEARCH_PROVIDERS } from "../settings.js";

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDERS)[number]["id"];

export type WebSearchMode = "web" | "news";

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

export interface WebSearchToolDetails<TProvider extends string = WebSearchProviderId> {
  provider: TProvider;
  attempts: string[];
  results: WebSearchResult[];
}

export interface WebSearchResultInput {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}
