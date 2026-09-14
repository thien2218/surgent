import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { WEB_SEARCH_PROVIDERS } from "../settings.js";
import { WebToolsFactory } from "../providers/index.js";
import { formatErrorMessage } from "./helpers.js";
import { getApiKey } from "../web-login/helpers.js";
import type { WebSearchResult } from "./types.js";
import { renderCallText, renderResultText } from "../../utils.js";

const webToolsFactory = new WebToolsFactory();

const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description: "Search web or news. Returns ranked title/summary/url results.",
  promptSnippet: "Search web or news. Returns ranked results.",
  promptGuidelines: [
    "Use web_search for external/unavailable info.",
    "Use web_search with news=true for recent reporting; default is web search.",
    "Use web_search with small max first; results are re-ranked best-first.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    max: Type.Optional(
      Type.Number({ description: "Max results (default: 5)", minimum: 1, maximum: 10 }),
    ),
    news: Type.Optional(Type.Boolean({ description: "Search news when true; web when false" })),
  }),
  async execute(_toolCallId, { query, max = 5, news = false }, signal, _onUpdate, ctx) {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error("Query must not be empty.");
    }

    const attempts: string[] = [];
    let anyConfiguredProvider = false;

    for (const provider of WEB_SEARCH_PROVIDERS) {
      if (signal?.aborted) {
        throw new Error("web_search was cancelled.");
      }

      const apiKey = await getApiKey(ctx.modelRegistry, provider.name);

      if (!apiKey) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      anyConfiguredProvider = true;

      try {
        const results = await webToolsFactory
          .createWebSearcher(provider.name, apiKey)
          .search(trimmed, news, max);

        if (results.length === 0) {
          attempts.push(`${provider.label}: returned no results`);
          continue;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { results } satisfies { results: WebSearchResult[] },
        };
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    if (!anyConfiguredProvider) {
      throw new Error(
        "No configured web search providers available. Use /web-login to configure Tavily, Brave Search, or Firecrawl.",
      );
    }

    throw new Error(
      `Web search failed across all configured providers.\n|- ${attempts.join("\n|- ")}`,
    );
  },
  renderCall(args, theme, { isPartial }) {
    return renderCallText(
      `${theme.fg("toolTitle", "web_search")} ${theme.fg("accent", args.query)}`,
      isPartial,
    );
  },
  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Searching..."), 0, 0);
    }
    const details = result.details as { results: WebSearchResult[] } | undefined;
    const text = (details?.results.map((item) => item.url) ?? ["No search results"]).join("\n");
    return renderResultText(text, theme, expanded);
  },
});

export default webSearchTool;
