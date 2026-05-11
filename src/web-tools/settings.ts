type Supported = "tavily" | "brave-search" | "jina" | "firecrawl";

type Provider = {
  id: Supported;
  label: string;
  note?: string;
};

export const WEB_SEARCH_PROVIDERS: Provider[] = [
  { id: "tavily", label: "Tavily" },
  { id: "brave-search", label: "Brave Search" },
  { id: "firecrawl", label: "Firecrawl" },
];

export const WEB_FETCH_PROVIDERS: Provider[] = [
  { id: "jina", label: "Jina", note: "optional, only helps increase rate limits" },
  { id: "firecrawl", label: "Firecrawl" },
  { id: "tavily", label: "Tavily" },
];

export const WEB_TOOLS_PROVIDERS = [
  ...new Map([...WEB_SEARCH_PROVIDERS, ...WEB_FETCH_PROVIDERS].map((p) => [p.id, p])).values(),
];
