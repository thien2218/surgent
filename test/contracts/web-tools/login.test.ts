import { expect, it } from "vitest";
import { getApiKey, getWebToolsProviderOptions } from "../../../src/web-tools/web-login/helpers.js";
import { loginSetup } from "./setup.js";

it("offers deduplicated providers and normalized command completions", async () => {
  const { command } = loginSetup();
  expect(getWebToolsProviderOptions()).toEqual(["Tavily", "Brave Search", "Firecrawl", "Jina"]);
  expect(await command.getArgumentCompletions?.(" TA ")).toEqual([{ value: "tavily", label: "Tavily" }]);
  expect(await command.getArgumentCompletions?.("unknown")).toBeNull();
  expect((await command.getArgumentCompletions?.(""))?.map(item => item.value)).toEqual(["tavily", "brave-search", "firecrawl", "jina"]);
});
it("normalizes explicit provider IDs and preserves unrelated credentials", async () => {
  const { command, ctx, credentials } = loginSetup({ input: "fake-new-key" });
  credentials.set("jina", { type: "api_key", key: "fake-other-key" });
  await command.handler(" TAVILY ", ctx);
  expect(credentials.get("tavily")?.key).toBe("fake-new-key");
  expect(credentials.get("jina")?.key).toBe("fake-other-key");
});
it("resolves selected provider labels", async () => {
  const { command, ctx, credentials, ui } = loginSetup({ input: "fake-jina-key" });
  ui.select.mockResolvedValueOnce("Jina");
  await command.handler("", ctx);
  expect(credentials.get("jina")?.key).toBe("fake-jina-key");
});
it("rejects unknown providers without reading or changing credentials", async () => {
  const { command, ctx, read, modify, ui } = loginSetup();
  await command.handler("unknown", ctx);
  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unknown provider"), "error");
  expect(read).not.toHaveBeenCalled();
  expect(modify).not.toHaveBeenCalled();
});
it("does nothing when provider selection is dismissed", async () => {
  const { command, ctx, read, ui } = loginSetup();
  ui.select.mockResolvedValueOnce(undefined);
  await command.handler("", ctx);
  expect(read).not.toHaveBeenCalled();
  expect(ui.custom).not.toHaveBeenCalled();
});
it.each([undefined, "Save new API key", "Clear saved API key"])("preserves credentials when action %j is dismissed or confirmation refused", async action => {
  const { command, ctx, credentials, modify, remove, ui } = loginSetup({ input: "fake-new-key" });
  credentials.set("tavily", { type: "api_key", key: "fake-existing-key" });
  ui.select.mockResolvedValueOnce(action);
  ui.confirm.mockResolvedValueOnce(false);
  await command.handler("tavily", ctx);
  expect(credentials.get("tavily")?.key).toBe("fake-existing-key");
  expect(modify).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(ui.custom).not.toHaveBeenCalled();
});
it("clears only the confirmed provider credential", async () => {
  const { command, ctx, credentials, ui } = loginSetup();
  credentials.set("tavily", { type: "api_key", key: "fake-existing-key" });
  credentials.set("jina", { type: "api_key", key: "fake-other-key" });
  ui.select.mockResolvedValueOnce("Clear saved API key");
  await command.handler("tavily", ctx);
  expect(credentials.has("tavily")).toBe(false);
  expect(credentials.get("jina")?.key).toBe("fake-other-key");
  expect(ui.notify).toHaveBeenCalledWith("Cleared Tavily API key", "info");
});
it("reports configured status without displaying a full API key", async () => {
  const { command, ctx, credentials, ui } = loginSetup();
  credentials.set("tavily", { type: "api_key", key: "fake-existing-secret" });
  ui.select.mockResolvedValueOnce(undefined);
  await command.handler("tavily", ctx);
  const messages = ui.notify.mock.calls.map(([message]) => message).join("\n");
  expect(messages).toContain("configured");
  expect(messages).not.toContain("fake-existing-secret");
});
it("does not interpret non-API-key credentials as provider keys", async () => {
  const { ctx, credentials } = loginSetup();
  credentials.set("tavily", { type: "oauth" });
  await expect(getApiKey(ctx.modelRegistry, "tavily")).resolves.toBeUndefined();
});
it.each(["read", "save", "clear"])("propagates credential %s failures without success notices", async operation => {
  const { command, ctx, read, modify, remove, credentials, ui } = loginSetup({ input: "fake-new-key" });
  const error = new Error("credential store unavailable");
  credentials.set("jina", { type: "api_key", key: "fake-other-key" });
  if (operation === "read") read.mockRejectedValueOnce(error);
  if (operation === "save") modify.mockRejectedValueOnce(error);
  if (operation === "clear") {
    credentials.set("tavily", { type: "api_key", key: "fake-existing-key" });
    ui.select.mockResolvedValueOnce("Clear saved API key");
    remove.mockRejectedValueOnce(error);
  }
  await expect(command.handler("tavily", ctx)).rejects.toBe(error);
  expect(credentials.get("jina")?.key).toBe("fake-other-key");
  expect(ui.notify.mock.calls.some(([message]) => /^(Saved|Cleared) /.test(message))).toBe(false);
});
