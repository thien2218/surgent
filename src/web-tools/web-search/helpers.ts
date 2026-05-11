import { normalizeText } from "../../utils.js";
import type { WebSearchResult, WebSearchResultInput } from "./types.js";

export function normalizeSearchResult(item: WebSearchResultInput): WebSearchResult | undefined {
  const title = normalizeText(item.title);
  const url = normalizeText(item.url);

  if (!title || !url) {
    return undefined;
  }

  return {
    description: normalizeText(item.description),
    title,
    url,
  };
}

export function joinSnippets(snippets: string[] | undefined): string {
  if (!Array.isArray(snippets)) {
    return "";
  }

  return snippets
    .filter((snippet) => typeof snippet === "string" && snippet.trim().length > 0)
    .join(" ")
    .trim();
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
