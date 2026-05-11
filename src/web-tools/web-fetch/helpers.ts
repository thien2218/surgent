import { normalizeText } from "../../utils.js";
import type { WebFetchResult } from "./types.js";

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

export function formatFetchResults(results: WebFetchResult[]): string {
  if (results.length === 0) {
    return "";
  }

  if (results.length === 1) {
    const result = results[0]!;
    return result.content;
  }

  return results
    .map(
      (result) =>
        `Source: ${result.url}\nProvider: ${result.provider}\n\n${result.content}`,
    )
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
