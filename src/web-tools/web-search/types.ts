import { WEB_SEARCH_PROVIDERS } from "../settings.js";

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDERS)[number]["name"];

export type WebSearchMode = "web" | "news";

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

export interface WebSearchToolDetails {
  results: WebSearchResult[];
}

export interface WebSearchResultInput {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}
