import { expect, it } from "vitest";
import { loginSetup } from "./setup.js";

it.each([undefined, "", "   "])("does not replace a saved credential with blank input %j", async input => {
  const { command, ctx, credentials, modify, ui } = loginSetup({ input });
  credentials.set("tavily", { type: "api_key", key: "fake-existing-key" });

  await command.handler("tavily", ctx);

  expect(credentials.get("tavily")).toEqual({ type: "api_key", key: "fake-existing-key" });
  expect(modify).not.toHaveBeenCalled();
  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No Tavily API key was saved"), "warning");
  expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("Saved Tavily"), "info");
});

it("trims a nonblank API key before storing it", async () => {
  const { command, ctx, credentials, ui } = loginSetup({ input: "  fake-new-key  " });

  await command.handler("tavily", ctx);

  expect(credentials.get("tavily")).toEqual({ type: "api_key", key: "fake-new-key" });
  expect(ui.notify).toHaveBeenCalledWith("Saved Tavily API key", "info");
});
