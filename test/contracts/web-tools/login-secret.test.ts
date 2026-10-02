import { expect, it } from "vitest";
import { loginSetup } from "./setup.js";

it("uses the masked custom prompt instead of plain input", async () => {
  const { command, ctx, credentials, ui } = loginSetup({ input: "fake-secret-key" });

  await command.handler("tavily", ctx);

  expect(ui.custom).toHaveBeenCalledOnce();
  expect(ui.input).not.toHaveBeenCalled();
  expect(credentials.get("tavily")?.key).toBe("fake-secret-key");
});

it.each([
  { mode: "tui" as const, hasUI: false },
  { mode: "rpc" as const, hasUI: true },
])("does not fall back to unmasked entry in mode $mode with UI=$hasUI", async options => {
  const { command, ctx, modify, ui } = loginSetup({ ...options, input: "fake-secret-key" });

  await command.handler("tavily", ctx);

  expect(ui.input).not.toHaveBeenCalled();
  expect(ui.custom).not.toHaveBeenCalled();
  expect(modify).not.toHaveBeenCalled();
});
