import { WEB_TOOLS_PROVIDERS } from "../settings.js";

export type WebSearchMode = "web" | "news";

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

export interface WebSearchToolDetails<TProvider extends string = string> {
  provider: TProvider;
  attempts: string[];
  results: WebSearchResult[];
}

export interface WebSearchResultInput {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}

export type WebToolsProvider = (typeof WEB_TOOLS_PROVIDERS)[number];
export type WebToolsProviderId = WebToolsProvider["id"];
