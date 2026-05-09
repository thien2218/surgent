import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  clearApiKey,
  findWebToolsProvider,
  formatProviderStatus,
  getWebToolsProviderByLabel,
  getWebToolsProviderOptions,
  setApiKey,
} from "./utils.js";
import { WEB_TOOLS_PROVIDERS } from "../settings.js";
import type { WebToolsProvider } from "../types.js";

function getArgumentCompletions(prefix: string) {
  const normalized = prefix.trim().toLowerCase();
  const matches = WEB_TOOLS_PROVIDERS.filter((provider) =>
    provider.aliases.some((alias) => alias.startsWith(normalized)),
  );

  if (matches.length === 0) {
    return null;
  }

  return matches.map((provider) => ({
    value: provider.aliases[0],
    label: provider.label,
  }));
}

function getSupportedProviderNames(): string {
  return WEB_TOOLS_PROVIDERS.map((provider) => provider.aliases[0]).join(", ");
}

async function selectProvider(
  ctx: ExtensionCommandContext,
): Promise<WebToolsProvider | undefined> {
  const selected = await ctx.ui.select(
    "Configure web provider authentication",
    getWebToolsProviderOptions(),
  );

  if (!selected) {
    return undefined;
  }

  return getWebToolsProviderByLabel(selected);
}

async function chooseAction(
  ctx: ExtensionCommandContext,
  provider: WebToolsProvider,
): Promise<"save" | "clear" | undefined> {
  const authStorage = ctx.modelRegistry.authStorage;
  const options = authStorage.getAuthStatus(provider.id).configured
    ? ["Save API key", "Clear saved API key"]
    : ["Save API key"];

  const selected = await ctx.ui.select(
    `${provider.label} credentials`,
    options,
  );

  if (!selected) {
    return undefined;
  }

  return selected === "Clear saved API key" ? "clear" : "save";
}

async function saveProviderKey(
  ctx: ExtensionCommandContext,
  provider: WebToolsProvider,
): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;

  if (authStorage.getAuthStatus(provider.id).configured) {
    const replace = await ctx.ui.confirm(
      `${provider.label} API key`,
      `${provider.label} already has a saved API key. Replace it?`,
    );
    if (!replace) {
      return;
    }
  }

  const apiKey = await ctx.ui.input(
    `${provider.label} API key`,
    `Paste your ${provider.label} API key`,
  );

  if (!apiKey) {
    ctx.ui.notify(`No ${provider.label} API key was saved`, "warning");
    return;
  }

  setApiKey(authStorage, provider.id, apiKey.trim());
  ctx.ui.notify(`Saved ${provider.label} API key`, "info");
}

async function clearProviderKey(
  ctx: ExtensionCommandContext,
  provider: WebToolsProvider,
): Promise<void> {
  const confirmed = await ctx.ui.confirm(
    `Clear ${provider.label} API key`,
    `Remove the saved ${provider.label} API key from shared auth storage?`,
  );
  if (!confirmed) {
    return;
  }

  clearApiKey(ctx.modelRegistry.authStorage, provider.id);
  ctx.ui.notify(`Cleared ${provider.label} API key`, "info");
}

export default function webLoginCommand(pi: ExtensionAPI) {
  pi.registerCommand("web-login", {
    description: "Configure API keys for authenticated web providers",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      const arg = args.trim();
      const provider = arg
        ? findWebToolsProvider(arg)
        : await selectProvider(ctx);

      if (!provider) {
        if (arg) {
          ctx.ui.notify(
            `Unknown provider \"${arg}\". Use ${getSupportedProviderNames()}.`,
            "error",
          );
        }
        return;
      }

      ctx.ui.notify(
        formatProviderStatus(ctx.modelRegistry.authStorage, provider),
        "info",
      );

      const action = await chooseAction(ctx, provider);
      if (!action) {
        return;
      }

      if (action === "clear") {
        await clearProviderKey(ctx, provider);
        return;
      }

      await saveProviderKey(ctx, provider);
    },
  });
}
