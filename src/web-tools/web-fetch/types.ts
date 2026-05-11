import type { WEB_FETCH_PROVIDERS } from "../settings.js";

export type WebFetchProviderId = (typeof WEB_FETCH_PROVIDERS)[number]["id"] | "native";

export interface WebFetchResult {
  url: string;
  provider: WebFetchProviderId;
  content: string;
}

export interface WebFetchFailure {
  url: string;
  provider: WebFetchProviderId;
  message: string;
}

export interface WebFetchProviderResponse {
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}

export interface WebFetchToolDetails {
  attempts: string[];
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}
