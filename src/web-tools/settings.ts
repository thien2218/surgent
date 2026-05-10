export const WEB_SEARCH_PROVIDERS = [
  {
    id: "tavily",
    label: "Tavily",
  },
  {
    id: "brave-search",
    label: "Brave Search",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
  },
] as const;

export const WEB_FETCH_PROVIDERS = [
  {
    id: "jina",
    label: "Jina",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
  },
  {
    id: "tavily",
    label: "Tavily",
  },
] as const;

export const WEB_TOOLS_PROVIDERS = [
  ...new Map(
    [...WEB_SEARCH_PROVIDERS, ...WEB_FETCH_PROVIDERS].map((p) => [p.id, p]),
  ).values(),
];
