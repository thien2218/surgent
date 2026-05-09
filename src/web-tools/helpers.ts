import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import { WEB_TOOLS_PROVIDERS } from "../settings.js";
import type {
  WebSearchResult,
  WebSearchResultInput,
  WebToolsProvider,
  WebToolsProviderId,
} from "./types.js";
import { normalizeText } from "../utils.js";

export function normalizeSearchResult(
  item: WebSearchResultInput,
): WebSearchResult | undefined {
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
    .filter(
      (snippet) => typeof snippet === "string" && snippet.trim().length > 0,
    )
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

export function findWebToolsProvider(
  input: string,
): WebToolsProvider | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  return WEB_TOOLS_PROVIDERS.find((provider) =>
    provider.aliases.some((alias) => alias === normalized),
  );
}

export function getWebToolsProviderOptions(): string[] {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.label);
}

export function getWebToolsProviderByLabel(
  label: string,
): WebToolsProvider | undefined {
  return WEB_TOOLS_PROVIDERS.find((provider) => provider.label === label);
}

export function formatProviderStatus(
  authStorage: AuthStorage,
  provider: WebToolsProvider,
): string {
  const status = authStorage.getAuthStatus(provider.id);
  if (!status.configured) {
    return `${provider.label} (not configured)`;
  }

  const source = status.source ? ` via ${status.source}` : "";
  return `${provider.label} (configured${source})`;
}

export function setApiKey(
  authStorage: AuthStorage,
  providerId: WebToolsProviderId,
  apiKey: string,
): void {
  authStorage.set(providerId, { type: "api_key", key: apiKey });
}

export function clearApiKey(
  authStorage: AuthStorage,
  providerId: WebToolsProviderId,
): void {
  authStorage.remove(providerId);
}

export function getArgumentCompletions(prefix: string) {
  const normalized = prefix.trim().toLowerCase();
  const matches = WEB_TOOLS_PROVIDERS.filter((provider) =>
    provider.aliases.some((alias) => alias.startsWith(normalized)),
  );

  if (matches.length === 0) {
    return null;
  }

  return matches.map((provider) => ({
    value: provider.id,
    label: provider.label,
  }));
}

export function getSupportedProviderNames(): string {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.id).join(", ");
}
