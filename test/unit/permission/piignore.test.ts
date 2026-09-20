import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { getPiIgnoreInputs } from "../../../src/permission/piignore.js";

function toolCall(toolName: string, input: Record<string, unknown>): ToolCallEvent {
  return { toolName, input } as ToolCallEvent;
}

describe("getPiIgnoreInputs", () => {
  it.each(["read", "write", "edit"])("extracts path from %s calls", (toolName) => {
    expect(getPiIgnoreInputs(toolCall(toolName, { path: "src/index.ts" }))).toEqual([
      "src/index.ts",
    ]);
  });

  it("extracts grep path and glob in order", () => {
    expect(getPiIgnoreInputs(toolCall("grep", { path: "src", glob: "**/*.ts" }))).toEqual([
      "src",
      "**/*.ts",
    ]);
  });

  it.each([
    [{ path: "src" }, ["src"]],
    [{ glob: "**/*.ts" }, ["**/*.ts"]],
    [{ path: "", glob: "" }, []],
    [{}, []],
  ])("includes only present grep inputs", (input, expected) => {
    expect(getPiIgnoreInputs(toolCall("grep", input))).toEqual(expected);
  });

  it("ignores unrelated tools", () => {
    expect(getPiIgnoreInputs(toolCall("bash", { command: "cat secret" }))).toEqual([]);
  });
});
