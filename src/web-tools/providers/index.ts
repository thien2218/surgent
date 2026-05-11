import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import { WEB_FETCH_PROVIDERS, WEB_SEARCH_PROVIDERS } from "../settings.js";

export * from "./brave.js";
export * from "./firecrawl.js";
export * from "./jina.js";
export * from "./native.js";
export * from "./tavily.js";

export interface WebSearchProvider {}

export interface WebFetchProvider {}

export class WebTools {
  private provider?: WebSearchProvider | WebFetchProvider;
  private readonly supported = {
    search: WEB_SEARCH_PROVIDERS,
    fetch: WEB_FETCH_PROVIDERS,
  };

  constructor(
    private readonly authStorage: AuthStorage,
    private readonly signal?: AbortSignal,
  ) {}

  private getProvider() {}

  search() {}

  fetch() {}
}
