import type { AuthStorage } from "@earendil-works/pi-coding-agent";

export const WEB_AUTH_PROVIDERS = [
  {
    id: "tavily",
    label: "Tavily",
    aliases: ["tavily"],
  },
  {
    id: "brave-search",
    label: "Brave Search",
    aliases: ["brave", "brave-search"],
  },
] as const;

export type WebAuthProvider = (typeof WEB_AUTH_PROVIDERS)[number];
export type WebAuthProviderId = WebAuthProvider["id"];

export function findWebAuthProvider(
  input: string,
): WebAuthProvider | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  return WEB_AUTH_PROVIDERS.find((provider) =>
    provider.aliases.some((alias) => alias === normalized),
  );
}

export function getWebAuthProviderOptions(): string[] {
  return WEB_AUTH_PROVIDERS.map((provider) => provider.label);
}

export function getWebAuthProviderByLabel(
  label: string,
): WebAuthProvider | undefined {
  return WEB_AUTH_PROVIDERS.find((provider) => provider.label === label);
}

export function formatProviderStatus(
  authStorage: AuthStorage,
  provider: WebAuthProvider,
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
  providerId: WebAuthProviderId,
  apiKey: string,
): void {
  authStorage.set(providerId, { type: "api_key", key: apiKey });
}

export function clearApiKey(
  authStorage: AuthStorage,
  providerId: WebAuthProviderId,
): void {
  authStorage.remove(providerId);
}
