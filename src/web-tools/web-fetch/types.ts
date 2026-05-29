import type { WEB_FETCH_PROVIDERS } from "../settings.js";

export type WebFetchProviderId = (typeof WEB_FETCH_PROVIDERS)[number]["name"] | "native";

export type WebFetchResponse = {
  url: string;
  provider: WebFetchProviderId;
} & ({ content: string; error?: never } | { error: string; content?: never });
