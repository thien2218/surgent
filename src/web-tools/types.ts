import { WEB_TOOLS_PROVIDERS } from "../settings.js";

export type WebSearchMode = "web" | "news";
export type WebFetchProviderId =
  | "native-fetch"
  | "jina"
  | "firecrawl"
  | "tavily";
export type WebFetchContentKind = "markdown" | "text";

export interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

export interface WebFetchResult {
  requestedUrl: string;
  resolvedUrl: string;
  content: string;
  contentKind: WebFetchContentKind;
  provider: WebFetchProviderId;
}

export interface WebFetchFailure {
  requestedUrl: string;
  provider: WebFetchProviderId;
  message: string;
}

export interface WebFetchProviderResponse {
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}

export interface WebSearchToolDetails<TProvider extends string = string> {
  provider: TProvider;
  attempts: string[];
  results: WebSearchResult[];
}

export interface WebFetchToolDetails<TProvider extends string = WebFetchProviderId> {
  provider: TProvider | undefined;
  attempts: string[];
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}

export interface WebSearchResultInput {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}

export interface WebFetchArgumentsInput {
  url?: string | undefined;
  urls?: string[] | undefined;
}

export type WebToolsProvider = (typeof WEB_TOOLS_PROVIDERS)[number];
export type WebToolsProviderId = WebToolsProvider["id"];
