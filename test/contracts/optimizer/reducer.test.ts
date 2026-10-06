import { beforeEach, expect, it } from "vitest";
import reducerExtension from "../../../src/optimizer/reducer/index.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

beforeEach(async () => {
  await createWorkspace({ prefix: "surgent-reducer-contract-", changeCwd: true });
});

it("advertises bash as text-only with a required purpose", () => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  const bash = pi.tool("bash");

  expect(bash.outputSchema).toBeUndefined();
  expect(bash.prepareArguments).toBeUndefined();
  expect(bash.parameters.required).toContain("purpose");
  expect(bash.parameters.properties.purpose).toMatchObject({ type: "string", minLength: 1, maxLength: 256, pattern: "\\S" });
});

it("limits grep context and advertises delayed summaries without settling itself", () => {
  const pi = recordExtension();
  reducerExtension(pi.api);

  expect(pi.tool("grep").parameters.properties.context).toMatchObject({ type: "number", maximum: 3 });
  expect(pi.tool("grep").description).toContain("compacted into summaries only after you finish responding");
  expect(() => pi.event("agent_before_settle")).toThrow("Missing event registration");
});
