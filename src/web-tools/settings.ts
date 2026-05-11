export const WEB_SEARCH_PROVIDERS = [
  { name: "tavily", label: "Tavily" },
  { name: "brave-search", label: "Brave Search" },
  { name: "firecrawl", label: "Firecrawl" },
] as const;

export const WEB_FETCH_PROVIDERS = [
  { name: "jina", label: "Jina", note: "optional, only helps increase rate limits" },
  { name: "firecrawl", label: "Firecrawl" },
  { name: "tavily", label: "Tavily" },
] as const;

export const WEB_TOOLS_PROVIDERS = [
  ...new Map([...WEB_SEARCH_PROVIDERS, ...WEB_FETCH_PROVIDERS].map((p) => [p.name, p])).values(),
];
