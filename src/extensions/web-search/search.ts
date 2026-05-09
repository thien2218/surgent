import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WEB_TOOLS_PROVIDERS } from "../settings.js";

type WebSearchMode = "web" | "news";
type WebSearchProviderId = (typeof WEB_TOOLS_PROVIDERS)[number]["id"];

interface WebSearchResult {
  title: string;
  description: string;
  url: string;
}

interface WebSearchToolDetails {
  provider: WebSearchProviderId;
  attempts: string[];
  results: WebSearchResult[];
}

interface WebSearchResultInput {
  title?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
}

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
  }>;
}

interface BraveSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
  extra_snippets?: string[];
  meta_url?: {
    href?: string;
  };
}

interface BraveSearchResponse {
  results?: BraveSearchItem[];
  news?: {
    results?: BraveSearchItem[];
  };
  web?: {
    results?: BraveSearchItem[];
  };
}

interface FirecrawlSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
}

interface FirecrawlSearchData {
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

interface FirecrawlSearchResponse {
  data?: FirecrawlSearchData;
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description:
    "Search the public web or recent news and return up to 10 normalized results with title, description, and url.",
  promptSnippet:
    "Search the public web or recent news and return normalized top results",
  promptGuidelines: [
    "Use web_search when the user needs current information or external sources that are not already available in the workspace context.",
    "Use web_search with mode set to news for headline-driven or recent reporting queries, and mode set to web for general web results.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "The web search query to run" }),
    mode: StringEnum(["web", "news"] as const),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const query = params.query.trim();
    if (!query) {
      throw new Error("Query must not be empty.");
    }

    const attempts: string[] = [];
    let anyConfiguredProvider = false;

    for (const provider of WEB_TOOLS_PROVIDERS) {
      if (signal?.aborted) {
        throw new Error("web_search was cancelled.");
      }

      const apiKey = await ctx.modelRegistry.authStorage.getApiKey(
        provider.id,
        {
          includeFallback: false,
        },
      );

      if (!apiKey) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      anyConfiguredProvider = true;

      try {
        const results = await searchWithProvider(
          provider.id,
          apiKey,
          query,
          params.mode,
          signal,
        );

        if (results.length === 0) {
          attempts.push(`${provider.label}: returned no results`);
          continue;
        }

        const topResults = results.slice(0, 10);
        return {
          content: [
            { type: "text", text: JSON.stringify(topResults, null, 2) },
          ],
          details: {
            provider: provider.id,
            attempts,
            results: topResults,
          } satisfies WebSearchToolDetails,
        };
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    if (!anyConfiguredProvider) {
      throw new Error(
        "No configured web search providers are available. Use /web-login to configure Tavily, Brave Search, or Firecrawl.",
      );
    }

    throw new Error(
      `Web search failed across all configured providers. ${attempts.join(" | ")}`,
    );
  },
});

export default function registerWebSearchTool(pi: ExtensionAPI) {
  pi.registerTool(webSearchTool);
}

async function searchWithProvider(
  providerId: WebSearchProviderId,
  apiKey: string,
  query: string,
  mode: WebSearchMode,
  signal: AbortSignal | undefined,
): Promise<WebSearchResult[]> {
  switch (providerId) {
    case "tavily":
      return searchWithTavily(apiKey, query, mode);
    case "brave-search":
      return searchWithBrave(apiKey, query, mode, signal);
    case "firecrawl":
      return searchWithFirecrawl(apiKey, query, mode);
  }
}

async function searchWithTavily(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
): Promise<WebSearchResult[]> {
  const tavilyModule = (await import("@tavily/core")) as {
    tavily?: (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };

  if (typeof tavilyModule.tavily !== "function") {
    throw new Error("Tavily SDK export was not found.");
  }

  const client = tavilyModule.tavily({ apiKey });
  const response = (await client.search(query, {
    includeAnswer: false,
    includeRawContent: false,
    maxResults: 10,
    searchDepth: "basic",
    topic: mode === "news" ? "news" : "general",
  })) as TavilySearchResponse;

  return (response.results ?? [])
    .map((item) =>
      normalizeSearchResult({
        description: item.content,
        title: item.title,
        url: item.url,
      }),
    )
    .filter(isDefined);
}

async function searchWithBrave(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
  signal: AbortSignal | undefined,
): Promise<WebSearchResult[]> {
  const endpoint = mode === "news" ? "news/search" : "web/search";
  const searchParams = new URLSearchParams({
    count: "10",
    extra_snippets: "true",
    q: query,
  });

  const response = await fetch(
    `https://api.search.brave.com/res/v1/${endpoint}?${searchParams.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: signal ?? null,
    },
  );

  if (!response.ok) {
    throw new Error(await getHttpError(response));
  }

  const payload = (await response.json()) as BraveSearchResponse;
  const items =
    mode === "news"
      ? (payload.news?.results ?? payload.results ?? [])
      : (payload.web?.results ?? payload.results ?? []);

  return items
    .map((item) =>
      normalizeSearchResult({
        description:
          item.description ?? item.snippet ?? joinSnippets(item.extra_snippets),
        title: item.title,
        url: item.url ?? item.meta_url?.href,
      }),
    )
    .filter(isDefined);
}

async function searchWithFirecrawl(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
): Promise<WebSearchResult[]> {
  const firecrawlModule = (await import("@mendable/firecrawl-js")) as {
    Firecrawl?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    FirecrawlApp?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    default?: new (options: { apiKey: string }) => {
      search: (
        query: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };

  const FirecrawlClient =
    firecrawlModule.FirecrawlApp ??
    firecrawlModule.Firecrawl ??
    firecrawlModule.default;

  if (typeof FirecrawlClient !== "function") {
    throw new Error("Firecrawl SDK export was not found.");
  }

  const client = new FirecrawlClient({ apiKey });
  const response = (await client.search(query, {
    limit: 10,
    sources: [mode],
  })) as FirecrawlSearchResponse;

  const data = response.data ?? response;
  const items = mode === "news" ? (data.news ?? []) : (data.web ?? []);

  return items
    .map((item) =>
      normalizeSearchResult({
        description: item.description ?? item.snippet,
        title: item.title,
        url: item.url,
      }),
    )
    .filter(isDefined);
}

function normalizeSearchResult(
  item: WebSearchResultInput,
): WebSearchResult | undefined {
  const title = normalizeText(item.title);
  const url = normalizeText(item.url);

  if (!title || !url) {
    return undefined;
  }

  return {
    description: normalizeText(item.description),
    title,
    url,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinSnippets(snippets: string[] | undefined): string {
  if (!Array.isArray(snippets)) {
    return "";
  }

  return snippets
    .filter(
      (snippet) => typeof snippet === "string" && snippet.trim().length > 0,
    )
    .join(" ")
    .trim();
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

async function getHttpError(response: Response): Promise<string> {
  const responseText = await response.text();
  const body = responseText.trim();

  if (!body) {
    return `HTTP ${response.status}`;
  }

  return `HTTP ${response.status}: ${body}`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
