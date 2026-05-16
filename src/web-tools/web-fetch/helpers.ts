import { normalizeText } from "../../utils.js";
import { getCacheFilePath } from "./storage.js";
import type { WebFetchProviderResponse, WebFetchResult } from "./types.js";

export function normalizeFetchedContent(value: unknown): string {
  return normalizeText(value).replace(/\r\n/g, "\n");
}

export function toCanonicalUrl(value: string): string {
  const normalized = normalizeText(value);
  try {
    return new URL(normalized).href;
  } catch {
    return normalized;
  }
}

export function isTextLikeContentType(contentType: string | null): boolean {
  const normalized = normalizeText(contentType).toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("html")
  );
}

export function formatFetchResults(results: WebFetchResult[], cacheDate: string): string {
  return results
    .map((result) => {
      const filePath = getCacheFilePath(result.url, cacheDate);
      return `Source: ${result.url}\nProvider: ${result.provider}\nPath: ${filePath}\n\n${result.summary}`;
    })
    .join("\n\n---\n\n");
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export async function getHttpError(response: Response): Promise<string> {
  const responseText = await response.text();
  const body = responseText.trim();

  if (!body) {
    return `HTTP ${response.status}`;
  }

  return `HTTP ${response.status}: ${body}`;
}

export function getValidatedUrls(urls: string[]): string[] {
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

export function formatAttempt(
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
