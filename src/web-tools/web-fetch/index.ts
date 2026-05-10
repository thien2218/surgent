import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  formatErrorMessage,
  formatFetchResults,
  normalizeUrlInput,
} from "./helpers.js";
import {
  fetchWithFirecrawl,
  fetchWithJina,
  fetchWithNative,
  fetchWithTavily,
} from "../providers/index.js";
import type {
  WebFetchArgumentsInput,
  WebFetchFailure,
  WebFetchProviderId,
  WebFetchProviderResponse,
  WebFetchResult,
  WebFetchToolDetails,
} from "./types.js";

const FETCH_PROVIDERS = [
  { id: "native-fetch", label: "Native Fetch" },
  { id: "jina", label: "Jina" },
  { id: "firecrawl", label: "Firecrawl" },
  { id: "tavily", label: "Tavily" },
] as const satisfies ReadonlyArray<{
  id: WebFetchProviderId;
  label: string;
}>;

const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch one or more public URLs and return normalized markdown or plain-text content.",
  promptSnippet:
    "Fetch one or more URLs and return normalized markdown or plain text content",
  promptGuidelines: [
    "Use web_fetch when the user needs the content of one or more known URLs rather than a search results list.",
    "Use web_fetch when the task depends on extracting readable page content in markdown or plain text.",
  ],
  parameters: Type.Object({
    url: Type.Optional(
      Type.String({ description: "A single HTTP(S) URL to fetch" }),
    ),
    urls: Type.Optional(
      Type.Array(Type.String(), {
        description: "Multiple HTTP(S) URLs to fetch in one call",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const urls = getValidatedUrls(params);
    const attempts: string[] = [];
    const resultsByUrl = new Map<string, WebFetchResult>();
    const failuresByUrl = new Map<string, WebFetchFailure>();

    for (const provider of FETCH_PROVIDERS) {
      const pendingUrls = urls.filter((url) => !resultsByUrl.has(url));
      if (pendingUrls.length === 0) {
        break;
      }

      if (signal?.aborted) {
        throw new Error("web_fetch was cancelled.");
      }

      const apiKey = await getProviderApiKey(provider.id, ctx);
      if (
        (provider.id === "firecrawl" || provider.id === "tavily") &&
        !apiKey
      ) {
        attempts.push(`${provider.label}: not configured`);
        continue;
      }

      try {
        const response = await fetchWithProvider(
          provider.id,
          pendingUrls,
          apiKey,
          signal,
        );

        for (const result of response.results) {
          resultsByUrl.set(result.requestedUrl, result);
          failuresByUrl.delete(result.requestedUrl);
        }

        for (const failure of response.failures) {
          if (!resultsByUrl.has(failure.requestedUrl)) {
            failuresByUrl.set(failure.requestedUrl, failure);
          }
        }

        attempts.push(
          formatAttempt(provider.label, pendingUrls.length, response),
        );
      } catch (error) {
        attempts.push(`${provider.label}: ${formatErrorMessage(error)}`);
      }
    }

    const orderedResults = urls.flatMap((url) => {
      const result = resultsByUrl.get(url);
      return result ? [result] : [];
    });
    const failures = urls.flatMap((url) => {
      const failure = failuresByUrl.get(url);
      return failure ? [failure] : [];
    });

    if (orderedResults.length === 0) {
      throw new Error(`Web fetch failed for all URLs. ${attempts.join(" | ")}`);
    }

    return {
      content: [{ type: "text", text: formatFetchResults(orderedResults) }],
      details: {
        attempts,
        failures,
        provider: getAggregateProvider(orderedResults),
        results: orderedResults,
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
  signal: AbortSignal | undefined,
): Promise<WebFetchProviderResponse> {
  switch (providerId) {
    case "native-fetch":
      return fetchWithNative(urls, signal);
    case "jina":
      return fetchWithJina(urls, signal);
    case "firecrawl":
      return fetchWithFirecrawl(apiKey ?? "", urls);
    case "tavily":
      return fetchWithTavily(apiKey ?? "", urls);
  }
}

function getValidatedUrls(params: WebFetchArgumentsInput): string[] {
  const rawUrls = normalizeUrlInput(params);
  if (rawUrls.length === 0) {
    throw new Error("Provide at least one URL in `url` or `urls`.");
  }

  return Array.from(
    new Set(
      rawUrls.map((value) => {
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

function getAggregateProvider(
  results: WebFetchResult[],
): WebFetchProviderId | undefined {
  const providers = new Set(results.map((result) => result.provider));

  if (providers.size !== 1) {
    return undefined;
  }

  return results[0]?.provider;
}

async function getProviderApiKey(
  providerId: WebFetchProviderId,
  ctx: Parameters<typeof webFetchTool.execute>[4],
): Promise<string | undefined> {
  return ctx.modelRegistry.authStorage.getApiKey(providerId, {
    includeFallback: false,
  });
}
