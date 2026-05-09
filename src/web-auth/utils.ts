import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import { WEB_TOOLS_PROVIDERS } from "../settings.js";
import type { WebAuthProvider, WebAuthProviderId } from "./types.js";

export function findWebAuthProvider(
  input: string,
): WebAuthProvider | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  return WEB_TOOLS_PROVIDERS.find((provider) =>
    provider.aliases.some((alias) => alias === normalized),
  );
}

export function getWebAuthProviderOptions(): string[] {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.label);
}

export function getWebAuthProviderByLabel(
  label: string,
): WebAuthProvider | undefined {
  return WEB_TOOLS_PROVIDERS.find((provider) => provider.label === label);
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
