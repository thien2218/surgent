import type { WEB_FETCH_PROVIDERS } from "../settings.js";

export type WebFetchProviderId = (typeof WEB_FETCH_PROVIDERS)[number]["name"] | "native";

export interface WebFetchResult {
  url: string;
  provider: WebFetchProviderId;
  summary: string;
}

export interface WebFetchFailure {
  url: string;
  message: string;
}

export interface WebFetchProviderResponse {
  results: WebFetchResult[];
  failures: WebFetchFailure[];
}
