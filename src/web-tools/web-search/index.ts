import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WEB_SEARCH_PROVIDERS } from "../settings.js";
import {
  searchWithBrave,
  searchWithFirecrawl,
  searchWithTavily,
} from "../providers/index.js";
import { formatErrorMessage } from "./helpers.js";
import type {
  WebSearchMode,
  WebSearchResult,
  WebSearchToolDetails,
  WebSearchProviderId,
} from "./types.js";

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

    for (const provider of WEB_SEARCH_PROVIDERS) {
      if (signal?.aborted) {
        throw new Error("web_search was cancelled.");
      }

      const apiKey = await ctx.modelRegistry.authStorage.getApiKey(
        provider.id,
        { includeFallback: false },
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
    default:
      throw new Error("Invalid provider id.");
  }
}
