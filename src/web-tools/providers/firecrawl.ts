import {
  normalizeFetchedContent,
  toCanonicalUrl,
} from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";
import { normalizeSearchResult } from "../web-search/helpers.js";
import type { WebSearchMode, WebSearchResult } from "../web-search/types.js";
import { isDefined } from "../../utils.js";
import Firecrawl from "@mendable/firecrawl-js";

interface FirecrawlSearchItem {
  title?: string;
  description?: string;
  snippet?: string;
  url?: string;
}

interface FirecrawlSearchResponse {
  news?: FirecrawlSearchItem[];
  web?: FirecrawlSearchItem[];
}

interface FirecrawlDocument {
  markdown?: string;
  metadata?: {
    sourceURL?: string;
    ogUrl?: string;
  };
}

interface FirecrawlBatchJob {
  data?: FirecrawlDocument[];
}

export async function searchWithFirecrawl(
  apiKey: string,
  query: string,
  mode: WebSearchMode,
): Promise<WebSearchResult[]> {
  const client = new Firecrawl({ apiKey });
  const response = (await client.search(query, {
    limit: 10,
    sources: [mode],
  })) as FirecrawlSearchResponse;
  const items = response[mode] ?? [];

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

export async function fetchWithFirecrawl(
  apiKey: string,
  urls: string[],
): Promise<WebFetchProviderResponse> {
  const client = new Firecrawl({ apiKey });

  if (urls.length === 1) {
    const requestedUrl = urls[0]!;
    const document = (await client.scrape(requestedUrl, {
      formats: ["markdown", "html"],
    })) as FirecrawlDocument;

    return toFirecrawlProviderResponse(urls, [document]);
  }

  const batch = (await client.batchScrape(urls, {
    options: {
      formats: ["markdown", "html"],
    },
    pollInterval: 2,
    timeout: 30,
  })) as FirecrawlBatchJob;

  return toFirecrawlProviderResponse(urls, batch.data ?? []);
}

function toFirecrawlProviderResponse(
  urls: string[],
  documents: FirecrawlDocument[],
): WebFetchProviderResponse {
  const documentsByUrl = new Map(
    documents
      .map((document) => {
        const matchedUrl =
          document.metadata?.sourceURL || document.metadata?.ogUrl;

        if (!matchedUrl) {
          return undefined;
        }

        return [matchedUrl, document] as const;
      })
      .filter(isDefined),
  );

  const results: WebFetchResult[] = [];
  const failures: WebFetchFailure[] = [];

  for (const url of urls) {
    const document =
      documentsByUrl.get(toCanonicalUrl(url)) ??
      (urls.length === 1 ? documents[0] : undefined);
    const content = normalizeFetchedContent(document?.markdown);

    if (!content) {
      failures.push({
        message: "Firecrawl returned no markdown content.",
        provider: "firecrawl",
        url,
      });
      continue;
    }

    results.push({
      content,
      provider: "firecrawl",
      url,
    });
  }

  return { failures, results };
}
