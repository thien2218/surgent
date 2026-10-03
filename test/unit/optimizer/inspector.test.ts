import { describe, expect, it } from "vitest";
import { parseInspectToolDetails, pruneInspectResults } from "../../../src/optimizer/inspector/helpers.js";

function inspection(path: string, symbol: string, text: string) {
  return {
    role: "toolResult",
    toolName: "inspect",
    details: { path, symbol, range: [2, 4] },
    content: [{ type: "text", text }],
  };
}

describe("inspect details", () => {
  it("accepts one-based inclusive ranges, including a single line", () => {
    expect(parseInspectToolDetails({ path: "src/task.ts", symbol: "Worker.run~2", range: [1, 1] }))
      .toEqual({ path: "src/task.ts", symbol: "Worker.run~2", range: [1, 1] });
    expect(parseInspectToolDetails({ path: "src/task.ts", symbol: "imports~1", range: [2, 8], extra: true }))
      .toEqual({ path: "src/task.ts", symbol: "imports~1", range: [2, 8] });
  });

  it.each([
    ["missing details", undefined],
    ["null details", null],
    ["text details", "src/task.ts"],
    ["missing path", { symbol: "run", range: [1, 2] }],
    ["empty path", { path: "", symbol: "run", range: [1, 2] }],
    ["non-string path", { path: 1, symbol: "run", range: [1, 2] }],
    ["missing symbol", { path: "task.ts", range: [1, 2] }],
    ["empty symbol", { path: "task.ts", symbol: "", range: [1, 2] }],
    ["non-string symbol", { path: "task.ts", symbol: {}, range: [1, 2] }],
    ["missing range", { path: "task.ts", symbol: "run" }],
    ["non-array range", { path: "task.ts", symbol: "run", range: "1-2" }],
    ["short range", { path: "task.ts", symbol: "run", range: [1] }],
    ["long range", { path: "task.ts", symbol: "run", range: [1, 2, 3] }],
    ["zero-based range", { path: "task.ts", symbol: "run", range: [0, 2] }],
    ["negative range", { path: "task.ts", symbol: "run", range: [-1, 2] }],
    ["reversed range", { path: "task.ts", symbol: "run", range: [3, 2] }],
    ["fractional start", { path: "task.ts", symbol: "run", range: [1.5, 2] }],
    ["fractional end", { path: "task.ts", symbol: "run", range: [1, 2.5] }],
    ["string start", { path: "task.ts", symbol: "run", range: ["1", 2] }],
    ["string end", { path: "task.ts", symbol: "run", range: [1, "2"] }],
    ["non-finite start", { path: "task.ts", symbol: "run", range: [NaN, 2] }],
    ["non-finite end", { path: "task.ts", symbol: "run", range: [1, Infinity] }],
  ])("rejects %s rather than authorizing result pruning", (_label, details) => {
    expect(parseInspectToolDetails(details)).toBeUndefined();
  });
});

describe("inspect result pruning", () => {
  it("keeps the newest body for each file and exact symbol even when its range changes", () => {
    const old = inspection("task.ts", "Worker.run", "old body");
    const otherFile = inspection("other.ts", "Worker.run", "other file");
    const overload = inspection("task.ts", "Worker.run~2", "second declaration");
    const latest = inspection("task.ts", "Worker.run", "new body");
    latest.details.range = [10, 15];
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
    const malformed = { ...inspection("task.ts", "run", "invalid range"), details: { path: "task.ts", symbol: "run", range: [0, 2] } };
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
