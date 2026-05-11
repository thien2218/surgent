import type { WebFetchProviderId, WebFetchProviderResponse } from "../web-fetch/types.js";
import type { WebToolsProviderId } from "../web-login/types.js";
import type { WebSearchMode, WebSearchProviderId, WebSearchResult } from "../web-search/types.js";
import { BraveWebSearchProvider } from "./brave.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { JinaWebFetchProvider } from "./jina.js";
import { NativeWebFetchProvider } from "./native.js";
import { TavilyProvider } from "./tavily.js";

export interface WebSearchProvider {
  search(query: string, mode: WebSearchMode): Promise<WebSearchResult[]>;
}

export interface WebFetchProvider {
  fetch(urls: string[]): Promise<WebFetchProviderResponse>;
}

export class WebToolsFactory {
  createWebSearcher(name: WebSearchProviderId, apiKey?: string): WebSearchProvider {
    switch (name) {
      case "brave-search":
        return new BraveWebSearchProvider(this.requireApiKey(name, apiKey));
      case "firecrawl":
        return new FirecrawlProvider(this.requireApiKey(name, apiKey));
      case "tavily":
        return new TavilyProvider(this.requireApiKey(name, apiKey));
    }
  }

  createWebFetcher(name: WebFetchProviderId, apiKey?: string): WebFetchProvider {
    switch (name) {
      case "native":
        return new NativeWebFetchProvider();
      case "jina":
        return new JinaWebFetchProvider(apiKey);
      case "firecrawl":
        return new FirecrawlProvider(this.requireApiKey(name, apiKey));
      case "tavily":
        return new TavilyProvider(this.requireApiKey(name, apiKey));
    }
  }

  private requireApiKey(name: WebToolsProviderId, apiKey?: string): string {
    if (!apiKey) {
      throw new Error(`Provider ${name} requires an API key.`);
    }

    return apiKey;
  }
}
