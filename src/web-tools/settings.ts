export type SupportedProviders = "tavily" | "brave-search" | "jina" | "firecrawl";

type Provider = {
  name: SupportedProviders;
  label: string;
  note?: string;
};

export const WEB_SEARCH_PROVIDERS: Provider[] = [
  { name: "tavily", label: "Tavily" },
  { name: "brave-search", label: "Brave Search" },
  { name: "firecrawl", label: "Firecrawl" },
];

export const WEB_FETCH_PROVIDERS: Provider[] = [
  { name: "jina", label: "Jina", note: "optional, only helps increase rate limits" },
  { name: "firecrawl", label: "Firecrawl" },
  { name: "tavily", label: "Tavily" },
];

export const WEB_TOOLS_PROVIDERS = [
  ...new Map([...WEB_SEARCH_PROVIDERS, ...WEB_FETCH_PROVIDERS].map((p) => [p.name, p])).values(),
];
