import type { SupportedProviders } from "../settings.js";

export * from "./brave.js";
export * from "./firecrawl.js";
export * from "./jina.js";
export * from "./native.js";
export * from "./tavily.js";

export interface WebSearchProvider {}

export interface WebFetchProvider {}

export class WebToolsFactory {
  createWebSearcher(name: SupportedProviders, apiKey?: string): WebSearchProvider {}

  createWebFetcher(name: SupportedProviders, apiKey?: string): WebFetchProvider {}
}
