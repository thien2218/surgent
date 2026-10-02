import { ModelRegistry, ModelRuntime, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { getApiKey, setApiKey } from "../../../src/web-tools/web-login/helpers.js";
import { recordExtension } from "../../helpers/extension.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("shares saved and cleared login credentials across isolated real Pi runtimes", async () => {
  const home = await mkdtemp(join(tmpdir(), "surgent-web-auth-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("HOME", home);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network during credential persistence"); }));
  const options = {
    authPath: join(home, "auth.json"), modelsPath: null, modelsStorePath: join(home, "models.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  };
  const registry = new ModelRegistry(await ModelRuntime.create(options));
  await setApiKey(registry, "jina", "fake-unrelated-key");
  const ctx = {
    mode: "tui", hasUI: true, modelRegistry: registry,
    ui: { custom: async () => "fake-tavily-key", notify() {}, confirm: async () => true, select: async () => "Clear saved API key" },
  } as unknown as ExtensionCommandContext;
  const extension = recordExtension();
  webTools(extension.api);

  await extension.command("web-login").handler("tavily", ctx);
  const reopened = new ModelRegistry(await ModelRuntime.create(options));
  await expect(getApiKey(reopened, "tavily")).resolves.toBe("fake-tavily-key");
  await extension.command("web-login").handler("tavily", { ...ctx, modelRegistry: reopened });

  const cleared = new ModelRegistry(await ModelRuntime.create(options));
  await expect(getApiKey(cleared, "tavily")).resolves.toBeUndefined();
  await expect(getApiKey(cleared, "jina")).resolves.toBe("fake-unrelated-key");
});
