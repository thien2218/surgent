import TurndownService from "turndown";
import {
  formatErrorMessage,
  getFetchContentKind,
  getHttpError,
  isTextLikeContentType,
  normalizeFetchedContent,
} from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";

const turndown = new TurndownService();

export async function fetchWithNative(
  urls: string[],
  signal: AbortSignal | undefined,
): Promise<WebFetchProviderResponse> {
  const settled = await Promise.all(
    urls.map(async (url) => fetchSingleUrl(url, signal)),
  );

  return {
    failures: settled.flatMap((item) => item.failure ?? []),
    results: settled.flatMap((item) => item.result ?? []),
  };
}

async function fetchSingleUrl(
  url: string,
  signal: AbortSignal | undefined,
): Promise<{
  result?: WebFetchResult;
  failure?: WebFetchFailure;
}> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html, text/plain, text/markdown;q=0.9, */*;q=0.1",
      },
      signal: signal ?? null,
    });

    if (!response.ok) {
      throw new Error(await getHttpError(response));
    }

    const contentType = response.headers.get("content-type");
    if (!isTextLikeContentType(contentType)) {
      throw new Error(`Unsupported content type: ${contentType ?? "unknown"}`);
    }

    const rawBody = await response.text();
    const content = normalizeNativeContent(rawBody, contentType);

    if (!content) {
      throw new Error("Native fetch returned empty content.");
    }

    return {
      result: {
        content,
        contentKind: inferNativeContentKind(rawBody, contentType),
        provider: "native-fetch",
        requestedUrl: url,
        resolvedUrl: response.url || url,
      },
    };
  } catch (error) {
    return {
      failure: {
        message: formatErrorMessage(error),
        provider: "native-fetch",
        requestedUrl: url,
      },
    };
  }
}

function normalizeNativeContent(
  body: string,
  contentType: string | null,
): string {
  if (looksLikeHtml(body, contentType)) {
    return normalizeFetchedContent(turndown.turndown(body));
  }

  return normalizeFetchedContent(body);
}

function inferNativeContentKind(
  body: string,
  contentType: string | null,
): WebFetchResult["contentKind"] {
  if (looksLikeHtml(body, contentType)) {
    return "markdown";
  }

  return getFetchContentKind(contentType);
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
  const normalizedType = (contentType ?? "").toLowerCase();

  return (
    normalizedType.includes("html") ||
    /<html[\s>]/i.test(body) ||
    /<body[\s>]/i.test(body)
  );
}
