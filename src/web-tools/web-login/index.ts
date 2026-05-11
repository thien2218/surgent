import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  clearApiKey,
  findWebToolsProvider,
  formatProviderStatus,
  getArgumentCompletions,
  getSupportedProviderNames,
  getWebToolsProviderByLabel,
  getWebToolsProviderOptions,
  setApiKey,
} from "./helpers.js";
import type { WebToolsProvider } from "./types.js";

async function selectProvider(ctx: ExtensionCommandContext): Promise<WebToolsProvider | undefined> {
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
  const configured = authStorage.getAuthStatus(provider.name).configured;

  if (configured) {
    const selected = await ctx.ui.select(`${provider.label} credentials`, [
      "Save new API key",
      "Clear saved API key",
    ]);

    if (!selected) {
      return undefined;
    }

    return selected === "Clear saved API key" ? "clear" : "save";
  }

  return "save";
}

async function saveProviderKey(
  ctx: ExtensionCommandContext,
  provider: WebToolsProvider,
): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;
  const note = provider.name === "jina" ? ` (${provider.note})` : "";

  if (authStorage.getAuthStatus(provider.name).configured) {
    const replace = await ctx.ui.confirm(
      `${provider.label} API key`,
      `${provider.label} already has a saved API key. Replace it?`,
    );
    if (!replace) {
      return;
    }
  }

  const apiKey = await ctx.ui.input(
    `${provider.label} API key${note}`,
    `Paste your ${provider.label} API key`,
  );

  if (!apiKey) {
    ctx.ui.notify(`No ${provider.label} API key was saved`, "warning");
    return;
  }

  setApiKey(authStorage, provider.name, apiKey.trim());
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

  clearApiKey(ctx.modelRegistry.authStorage, provider.name);
  ctx.ui.notify(`Cleared ${provider.label} API key`, "info");
}

export default function webLoginCommand(pi: ExtensionAPI) {
  pi.registerCommand("web-login", {
    description: "Configure API keys for authenticated web providers",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      const arg = args.trim();
      const provider = arg ? findWebToolsProvider(arg) : await selectProvider(ctx);

      if (!provider) {
        if (arg) {
          ctx.ui.notify(
            `Unknown provider \"${arg}\". Supported providers: ${getSupportedProviderNames()}.`,
            "error",
          );
        }
        return;
      }

      ctx.ui.notify(formatProviderStatus(ctx.modelRegistry.authStorage, provider), "info");

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
