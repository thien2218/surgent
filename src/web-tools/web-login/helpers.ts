import type { CredentialStore } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
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

function getCredentialStore(modelRegistry: ModelRegistry): CredentialStore {
  return ((modelRegistry as unknown as { runtime: unknown }).runtime as {
    credentials: CredentialStore;
  }).credentials;
}

export async function getApiKey(
  modelRegistry: ModelRegistry,
  providerId: WebToolsProviderId,
): Promise<string | undefined> {
  const credential = await getCredentialStore(modelRegistry).read(providerId);
  return credential?.type === "api_key" ? credential.key : undefined;
}

export async function formatProviderStatus(
  modelRegistry: ModelRegistry,
  provider: WebToolsProvider,
): Promise<string> {
  const apiKey = await getApiKey(modelRegistry, provider.name);
  return apiKey
    ? `${provider.label} (configured — ${maskApiKey(apiKey)})`
    : `${provider.label} (not configured)`;
}

export async function setApiKey(
  modelRegistry: ModelRegistry,
  providerId: WebToolsProviderId,
  apiKey: string,
) {
  await getCredentialStore(modelRegistry).modify(providerId, async () => ({
    type: "api_key",
    key: apiKey,
  }));
}

export async function clearApiKey(modelRegistry: ModelRegistry, providerId: WebToolsProviderId) {
  await getCredentialStore(modelRegistry).delete(providerId);
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
