import { expect, it } from "vitest";
import { loginSetup } from "./setup.js";

it("uses the masked custom prompt instead of plain input", async () => {
  const { command, ctx, credentials, ui } = loginSetup({ input: "fake-secret-key" });

  await command.handler("tavily", ctx);

  expect(ui.custom).toHaveBeenCalledOnce();
  expect(ui.input).not.toHaveBeenCalled();
  expect(credentials.get("tavily")?.key).toBe("fake-secret-key");
});

it("does not prompt or modify credentials when UI is unavailable", async () => {
  const { command, ctx, modify, ui } = loginSetup({ hasUI: false, input: "fake-secret-key" });

  await command.handler("tavily", ctx);

  expect(ui.input).not.toHaveBeenCalled();
  expect(ui.custom).not.toHaveBeenCalled();
  expect(modify).not.toHaveBeenCalled();
});
