import type { CredentialStore } from "@earendil-works/pi-ai";
import { readStoredCredential, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { WEB_TOOLS_PROVIDERS } from "../settings.js";
import type { WebToolsProvider, WebToolsProviderId } from "./types.js";

export function findWebToolsProvider(input: string): WebToolsProvider | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return WEB_TOOLS_PROVIDERS.find((provider) => provider.name === normalized);
}

export function getWebToolsProviderOptions(): string[] {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.label);
}

export function getWebToolsProviderByLabel(label: string): WebToolsProvider | undefined {
  return WEB_TOOLS_PROVIDERS.find((provider) => provider.label === label);
}

function maskApiKey(key: string): string {
  if (key.length <= 4) return key;
  return key.slice(0, 4) + "*".repeat(key.length - 4);
}

export function formatProviderStatus(modelRegistry: ModelRegistry, provider: WebToolsProvider): string {
  const status = modelRegistry.getProviderAuthStatus(provider.name);
  if (!status.configured) {
    return `${provider.label} (not configured)`;
  }

  const source = status.source ? ` via ${status.source}` : "";
  const credential = readStoredCredential(provider.name);
  const keyDisplay =
    credential?.type === "api_key" && credential.key
      ? ` — ${maskApiKey(credential.key)}`
      : "";
  return `${provider.label} (configured${source}${keyDisplay})`;
}

export async function setApiKey(
  modelRegistry: ModelRegistry,
  providerId: WebToolsProviderId,
  apiKey: string,
) {
  await (((modelRegistry as unknown as { runtime: unknown }).runtime as {
    credentials: CredentialStore;
  }).credentials.modify(providerId, async () => ({ type: "api_key", key: apiKey })));
}

export async function clearApiKey(modelRegistry: ModelRegistry, providerId: WebToolsProviderId) {
  await (((modelRegistry as unknown as { runtime: unknown }).runtime as {
    credentials: CredentialStore;
  }).credentials.delete(providerId));
}

export function getArgumentCompletions(prefix: string) {
  const normalized = prefix.trim().toLowerCase();
  const matches = WEB_TOOLS_PROVIDERS.filter((provider) => provider.name.startsWith(normalized));

  if (matches.length === 0) {
    return null;
  }

  return matches.map((provider) => ({ value: provider.name, label: provider.label }));
}

export function getSupportedProviderNames(): string {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.name).join(", ");
}
