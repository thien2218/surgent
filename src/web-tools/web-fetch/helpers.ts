import { normalizeText } from "../../utils.js";
import { parseWebFetchContent } from "./parser.js";
import { getCacheFilePath } from "./storage.js";
import type { WebFetchResponse } from "./types.js";

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

export function formatFetchResult(result: WebFetchResponse, cacheDate: string): string {
  const filePath = getCacheFilePath(result.url, cacheDate);
  return `Source: ${result.url}\nProvider: ${result.provider}\nPath: ${filePath}\n\n${parseWebFetchContent(result.content!)}`;
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

export function getValidatedUrl(url: string): string {
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
}
