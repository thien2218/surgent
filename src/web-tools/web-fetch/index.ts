import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatErrorMessage, formatFetchResults } from "./helpers.js";
import {
  fetchWithFirecrawl,
  fetchWithJina,
  fetchWithNative,
  fetchWithTavily,
} from "../providers/index.js";
import type {
  WebFetchFailure,
  WebFetchProviderId,
  WebFetchProviderResponse,
  WebFetchResult,
  WebFetchToolDetails,
} from "./types.js";
import { WEB_FETCH_PROVIDERS } from "../settings.js";

const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch one or more public URLs and return normalized markdown or plain-text content.",
  promptSnippet: "Fetch one or more URLs and return normalized markdown or plain text content",
  promptGuidelines: [
    "Use web_fetch when the user needs the content of one or more known URLs rather than a search results list.",
    "Use web_fetch when the task depends on extracting readable page content in markdown or plain text.",
  ],
  parameters: Type.Object({
    urls: Type.Array(Type.String(), {
      description: "One or multiple HTTP(S) URLs to fetch in one call",
    }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const urls = getValidatedUrls(params.urls);
    const attempts: string[] = [];
    const resultsByUrl = new Map<string, WebFetchResult>();
    const failuresByUrl = new Map<string, WebFetchFailure>();

    for (const provider of WEB_FETCH_PROVIDERS) {
      const pendingUrls = urls.filter((url) => !resultsByUrl.has(url));
      if (pendingUrls.length === 0) {
        break;
      }

      if (signal?.aborted) {
        throw new Error("web_fetch was cancelled.");
      }

      const apiKey = await ctx.modelRegistry.authStorage.getApiKey(provider.id, {
        includeFallback: false,
      });

      if ((provider.id === "firecrawl" || provider.id === "tavily") && !apiKey) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      try {
        const response = await fetchWithProvider(provider.id, pendingUrls, apiKey);

        for (const result of response.results) {
          resultsByUrl.set(result.url, result);
          failuresByUrl.delete(result.url);
        }

        for (const failure of response.failures) {
          if (!resultsByUrl.has(failure.url)) {
            failuresByUrl.set(failure.url, failure);
          }
        }

        attempts.push(formatAttempt(provider.label, pendingUrls.length, response));
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    const results = urls.flatMap((url) => {
      const result = resultsByUrl.get(url);
      return result ? [result] : [];
    });
    const failures = urls.flatMap((url) => {
      const failure = failuresByUrl.get(url);
      return failure ? [failure] : [];
    });

    if (results.length === 0) {
      throw new Error(`Web fetch failed for all URLs. ${attempts.join(" | ")}`);
    }

    return {
      content: [{ type: "text", text: formatFetchResults(results) }],
      details: {
        attempts,
        failures,
        results,
      } satisfies WebFetchToolDetails,
    };
  },
});

export default function registerWebFetchTool(pi: ExtensionAPI) {
  pi.registerTool(webFetchTool);
}

async function fetchWithProvider(
  providerId: WebFetchProviderId,
  urls: string[],
  apiKey: string | undefined,
): Promise<WebFetchProviderResponse> {
  switch (providerId) {
    case "native":
      return fetchWithNative(urls);
    case "jina":
      return fetchWithJina(apiKey, urls);
    case "firecrawl":
      return fetchWithFirecrawl(apiKey ?? "", urls);
    case "tavily":
      return fetchWithTavily(apiKey ?? "", urls);
  }
  throw new Error(`Unsupported web fetch provider: ${providerId}`);
}

function getValidatedUrls(urls: string[]): string[] {
  return Array.from(
    new Set(
      urls.map((url) => {
        const value = url.trim();
        let parsed: URL;

        try {
          parsed = new URL(value);
        } catch {
          throw new Error(`Invalid URL: ${value}`);
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(`Unsupported URL protocol: ${value}`);
        }

        return parsed.href;
      }),
    ),
  );
}

function formatAttempt(
  label: string,
  attemptedCount: number,
  response: WebFetchProviderResponse,
): string {
  const failedCount = response.failures.length;
  const succeededCount = response.results.length;

  if (failedCount === 0) {
    return `${label}: resolved ${succeededCount}/${attemptedCount}`;
  }

  return `${label}: resolved ${succeededCount}/${attemptedCount}, failed ${failedCount}`;
}
