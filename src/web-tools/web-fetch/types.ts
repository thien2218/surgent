import type { WEB_FETCH_PROVIDERS } from "../settings.js";

export type WebFetchProviderId =
  | (typeof WEB_FETCH_PROVIDERS)[number]["id"]
  | "native";

export type WebFetchContentKind = "markdown" | "text";

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

export interface WebFetchToolDetails<
  TProvider extends string = WebFetchProviderId,
> {
  provider: TProvider | undefined;
  attempts: string[];
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}

export interface WebFetchArgumentsInput {
  url?: string | undefined;
  urls?: string[] | undefined;
}
