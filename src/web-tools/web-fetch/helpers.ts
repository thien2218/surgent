import { normalizeText } from "../../utils.js";
import type {
  WebFetchArgumentsInput,
  WebFetchContentKind,
  WebFetchResult,
} from "./types.js";

export function normalizeUrlInput(input: WebFetchArgumentsInput): string[] {
  const values = [input.url, ...(input.urls ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(values));
}

export function normalizeFetchedContent(value: unknown): string {
  return normalizeText(value).replace(/\r\n/g, "\n");
}

export function toCanonicalUrl(value: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  try {
    return new URL(normalized).href;
  } catch {
    return normalized;
  }
}

export function getFetchContentKind(
  contentType: string | null | undefined,
): WebFetchContentKind {
  const normalized = normalizeText(contentType).toLowerCase();

  if (
    normalized.includes("markdown") ||
    normalized.includes("md") ||
    normalized.includes("text/x-markdown")
  ) {
    return "markdown";
  }

  return "text";
}

export function isTextLikeContentType(
  contentType: string | null | undefined,
): boolean {
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
        `## ${result.requestedUrl}\n\nSource: ${result.resolvedUrl}\nProvider: ${result.provider}\n\n${result.content}`,
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
