import { describe, expect, it } from "vitest";
import { parseInspectToolDetails, pruneInspectResults } from "../../../src/optimizer/inspector/helpers.js";

function inspection(path: string, symbol: string, text: string) {
  return {
    role: "toolResult",
    toolName: "inspect",
    details: { path, symbol },
    content: [{ type: "text", text }],
  };
}

describe("inspect details", () => {
  it("accepts only file and symbol identity and drops extra metadata", () => {
    expect(parseInspectToolDetails({ path: "src/task.ts", symbol: "Worker.run~2" }))
      .toEqual({ path: "src/task.ts", symbol: "Worker.run~2" });
    expect(parseInspectToolDetails({ path: "src/task.ts", symbol: "imports~1", extra: true }))
      .toEqual({ path: "src/task.ts", symbol: "imports~1" });
  });

  it.each([
    ["missing details", undefined],
    ["null details", null],
    ["text details", "src/task.ts"],
    ["missing path", { symbol: "run" }],
    ["empty path", { path: "", symbol: "run" }],
    ["non-string path", { path: 1, symbol: "run" }],
    ["missing symbol", { path: "task.ts" }],
    ["empty symbol", { path: "task.ts", symbol: "" }],
    ["non-string symbol", { path: "task.ts", symbol: {} }],
  ])("rejects %s rather than authorizing result pruning", (_label, details) => {
    expect(parseInspectToolDetails(details)).toBeUndefined();
  });
});

describe("inspect result pruning", () => {
  it("keeps the newest body for each file and exact symbol", () => {
    const old = inspection("task.ts", "Worker.run", "old body");
    const otherFile = inspection("other.ts", "Worker.run", "other file");
    const overload = inspection("task.ts", "Worker.run~2", "second declaration");
    const latest = inspection("task.ts", "Worker.run", "new body");
    const user = { role: "user", content: "inspect the updated method" };
    const messages = [old, otherFile, overload, user, latest];

    expect(pruneInspectResults(messages)).toBe(true);
    expect(messages).toEqual([otherFile, overload, user, latest]);
    expect(messages.at(-1)).toBe(latest);
    expect(pruneInspectResults(messages)).toBe(false);
  });

  it("never lets failed or malformed results erase the last valid body", () => {
    const valid = inspection("task.ts", "run", "valid body");
    const failed = { ...inspection("task.ts", "run", "permission denied"), isError: true };
    const malformed = { ...inspection("task.ts", "run", "missing symbol"), details: { path: "task.ts" } };
    const messages = [valid, failed, malformed];

    expect(pruneInspectResults(messages)).toBe(false);
    expect(messages).toEqual([valid, failed, malformed]);
  });

  it("preserves errors, unrelated tools, and non-tool messages when removing superseded bodies", () => {
    const old = inspection("task.ts", "run", "old body");
    const failed = { ...old, isError: true };
    const otherTool = { ...old, toolName: "read" };
    const assistant = { ...old, role: "assistant" };
    const latest = inspection("task.ts", "run", "new body");
    const messages = [failed, otherTool, old, assistant, latest];

    expect(pruneInspectResults(messages)).toBe(true);
    expect(messages).toEqual([failed, otherTool, assistant, latest]);
  });

  it("leaves empty history unchanged", () => {
    const messages: Array<{ role?: string }> = [];

    expect(pruneInspectResults(messages)).toBe(false);
    expect(messages).toEqual([]);
  });
});
