import { formatErrorMessage, getHttpError, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";

export async function fetchWithJina(
  apiKey: string | undefined,
  urls: string[],
): Promise<WebFetchProviderResponse> {
  const settled = await Promise.all(urls.map(async (url) => fetchViaJina(apiKey, url)));

  return {
    failures: settled.flatMap((item) => item.failure ?? []),
    results: settled.flatMap((item) => item.result ?? []),
  };
}

async function fetchViaJina(
  apiKey: string | undefined,
  url: string,
): Promise<{
  result?: WebFetchResult;
  failure?: WebFetchFailure;
}> {
  try {
    const response = await fetch(toJinaUrl(url), {
      headers: {
        Accept: "text/plain, text/markdown;q=0.9",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(await getHttpError(response));
    }

    const body = normalizeFetchedContent(await response.text());
    const content = extractJinaMarkdown(body);

    if (!content) {
      throw new Error("Jina returned empty content.");
    }

    return {
      result: {
        content,
        provider: "jina",
        url,
      },
    };
  } catch (error) {
    return {
      failure: {
        message: formatErrorMessage(error),
        provider: "jina",
        url,
      },
    };
  }
}

function toJinaUrl(url: string): string {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
}

function extractJinaMarkdown(body: string): string {
  const marker = "Markdown Content:";
  const markerIndex = body.indexOf(marker);

  if (markerIndex === -1) {
    return body;
  }

  return body.slice(markerIndex + marker.length).trim();
}
