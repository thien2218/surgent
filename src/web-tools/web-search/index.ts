import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { WEB_SEARCH_PROVIDERS } from "../settings.js";
import { WebToolsFactory } from "../providers/index.js";
import { formatErrorMessage } from "./helpers.js";
import type { WebSearchToolDetails } from "./types.js";

const webToolsFactory = new WebToolsFactory();

const webSearchTool = defineTool({
  name: "web_search",
  label: "Web Search",
  description:
    "Search the public web or recent news and return up to 10 normalized results with title, description, and url.",
  promptSnippet: "Search the public web or recent news and return normalized top results",
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

      anyConfiguredProvider = true;
      const apiKey = await ctx.modelRegistry.authStorage.getApiKey(provider.name, {
        includeFallback: false,
      });

      if (!apiKey) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      try {
        const results = await webToolsFactory
          .createWebSearcher(provider.name, apiKey)
          .search(query, params.mode);

        if (results.length === 0) {
          attempts.push(`${provider.label}: returned no results`);
          continue;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { results } satisfies WebSearchToolDetails,
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
      `Web search failed across all configured providers.\n|- ${attempts.join("\n|- ")}`,
    );
  },
  renderCall(args, theme) {
    return new Text(`${theme.fg("toolTitle", "web_search")} ${args.query}`, 0, 0);
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Searching..."), 0, 0);
    }

    const details = result.details as WebSearchToolDetails | undefined;
    const urls = details?.results.map((item) => item.url) ?? [];

    if (urls.length === 0) {
      return new Text(theme.fg("dim", "No search results"), 0, 0);
    }

    const visibleUrls = urls.slice(0, 3);
    let text = visibleUrls.join("\n");

    if (urls.length > visibleUrls.length) {
      text += `\n...and ${urls.length - visibleUrls.length} more results`;
    }

    return new Text(text, 0, 0);
  },
});

export default function registerWebSearchTool(pi: ExtensionAPI) {
  pi.registerTool(webSearchTool);
}
