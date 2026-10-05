import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createErrorResult, formatSnapshotText, formatToolUse, getLastAssistantOutput } from "../../../src/subagent/helpers.js";
import { assistantMessage } from "../../helpers/commands.js";

function output(messages: AgentSession["messages"]) {
  return getLastAssistantOutput({ messages } as AgentSession);
}

describe("subagent output helpers", () => {
  it("returns the newest assistant text block without mutating history", () => {
    const latest = assistantMessage("first block");
    latest.content.push({ type: "text", text: "last block" });
    const messages = [assistantMessage("old"), latest, { role: "user" as const, content: "question", timestamp: 0 }];
    const original = structuredClone(messages);
    expect(output(messages)).toBe("last block");
    expect(messages).toEqual(original);
  });

  it("skips non-text assistant messages and other roles", () => {
    const toolCall = assistantMessage("");
    toolCall.content = [{ type: "toolCall", id: "call", name: "read", arguments: { path: "file" } }];
    expect(output([assistantMessage("answer"), toolCall, { role: "user", content: "question", timestamp: 0 }])).toBe("answer");
    expect(output([toolCall])).toBe("");
    expect(output([])).toBe("");
  });

  it("preserves an explicitly empty latest text block", () => {
    expect(output([assistantMessage("old"), assistantMessage("")])).toBe("");
  });

  it.each([undefined, null, 42, "path", false])("formats absent or primitive arguments %j", (args) => {
    expect(formatToolUse("read", args)).toBe("read()");
  });

  it("formats object arguments and survives non-serializable arguments", () => {
    expect(formatToolUse("read", { path: "file.ts" })).toBe('read({"path":"file.ts"})');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatToolUse("read", circular)).toBe("read(<args>)");
    expect(formatToolUse("read", { value: 1n })).toBe("read(<args>)");
  });

  it("creates independent zero-usage error results", () => {
    const result = createErrorResult("Unavailable");
    expect(result).toEqual({ status: "error", output: "Unavailable", toolCounts: {}, usage: {
      input: 0, output: 0, toolCalls: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } });
    result.usage.cost.total = 5;
    expect(createErrorResult("Other").usage.cost.total).toBe(0);
  });

  it.each([[0, "0.0k"], [1500, "1.5k"], [9999, "10.0k"], [10000, "10k"], [10999, "10k"]] as const)(
    "formats token count %i as %s", (count, formatted) => {
      const usage = createErrorResult("").usage;
      usage.input = count;
      usage.output = count;
      usage.cost.total = 0.12345;
      expect(formatSnapshotText({ id: "child", status: "running", toolsUsed: [], usage }))
        .toEqual([`  tools_used=0 | in=${formatted} | out=${formatted} | cost=$0.123 | ctx=n/a`]);
    },
  );

  it.each([undefined, null, 0, 12.34])("formats context percentage %s", (percent) => {
    const lines = formatSnapshotText({ id: "child", status: "running", toolsUsed: [], usage: createErrorResult("").usage,
      contextUsage: percent === undefined ? undefined : { tokens: 0, contextWindow: 100, percent },
    });
    expect(lines[0]).toContain(`ctx=${percent == null ? "n/a" : `${percent.toFixed(1)}%`}`);
  });

  it("shows only five latest tool calls in order with a final branch marker", () => {
    const lines = formatSnapshotText({ id: "child", status: "running", usage: createErrorResult("").usage,
      toolsUsed: ["old", "read()", "grep()", "find()", "write()", "edit()"],
    });
    expect(lines.slice(1)).toEqual(["  ├─ read()", "  ├─ grep()", "  ├─ find()", "  ├─ write()", "  └─ edit()"]);
  });
});
