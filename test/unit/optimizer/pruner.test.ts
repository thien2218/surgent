import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ContextEvent, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { getRemovedToolCallId, removeEntries } from "../../../src/optimizer/pruner/cleanup.js";
import { buildPrunerState, filterContextMessages } from "../../../src/optimizer/pruner/context.js";
import { assistantMessage } from "../../helpers/commands.js";

function result(toolCallId: string, toolName: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0,
  };
}

function entry(id: string, parentId: string | null, message: SessionMessageEntry["message"]) {
  return {
    type: "message", id, parentId, timestamp: "2025-01-01T00:00:00.000Z", message,
  } satisfies SessionMessageEntry;
}

describe("prunable results", () => {
  it.each(["read", "inspect", "find", "edit"])("removes failed %s results", (toolName) => {
    expect(getRemovedToolCallId(result("failed", toolName, "failure", true))).toBe("failed");
  });

  it("retains bash failures because command output remains useful", () => {
    expect(getRemovedToolCallId(result("shell", "bash", "exit status 1", true))).toBeUndefined();
  });

  it.each([
    ["ls", "(empty directory)"],
    ["find", "No files found matching pattern"],
    ["find", "No changes found."],
    ["find", "No changes in selected files."],
  ])("removes empty %s output: %s", (toolName, text) => {
    expect(getRemovedToolCallId(result("empty", toolName, text))).toBe("empty");
  });

  it.each([
    ["read", "(empty directory)"],
    ["bash", "No files found matching pattern"],
    ["find", "No files found matching pattern\nadditional information"],
    ["ls", ""],
    ["find", "source.ts"],
  ])("preserves meaningful %s output: %s", (toolName, text) => {
    expect(getRemovedToolCallId(result("keep", toolName, text))).toBeUndefined();
  });

  it("preserves empty-looking text accompanied by other output", () => {
    const message = result("keep", "find", "No files found matching pattern");
    message.content.push({ type: "text", text: "diagnostic" });

    expect(getRemovedToolCallId(message)).toBeUndefined();
  });
});

describe("context pruning", () => {
  it("derives removed IDs only from valid tool-result entries", () => {
    const failed = result("failed", "read", "missing", true);
    const empty = result("empty", "find", "No files found matching pattern");
    const entries = [
      entry("failed-result", null, failed),
      entry("empty-result", null, empty),
      entry("bash-result", null, result("bash", "bash", "exit 1", true)),
      { type: "custom", message: result("custom", "read", "missing", true) },
      { type: "message", message: { ...failed, toolCallId: "" } },
      { type: "message", message: { ...failed, toolCallId: "invalid", toolName: "" } },
    ];

    expect(buildPrunerState(entries)).toEqual(new Set(["failed", "empty"]));
  });

  it("removes failed calls and results but keeps assistant explanations and successful calls", () => {
    const assistant = assistantMessage("explanation");
    assistant.content.push(
      { type: "toolCall", id: "failed", name: "read", arguments: {} },
      { type: "toolCall", id: "keep", name: "bash", arguments: {} },
    );
    const kept = result("keep", "bash", "exit 1", true);
    const messages: ContextEvent["messages"] = [assistant, result("failed", "read", "missing", true), kept];
    const original = structuredClone(messages);

    expect(filterContextMessages(messages, new Set(["failed"]))).toEqual({
      changed: true,
      messages: [{ ...assistant, content: [assistant.content[0], assistant.content[2]] }, kept],
    });
    expect(messages).toEqual(original);
  });

  it.each([false, true])("drops assistant turns with no non-thinking content left (thinking=%s)", (thinking) => {
    const assistant = assistantMessage("");
    assistant.content = [{ type: "toolCall", id: "failed", name: "read", arguments: {} }];
    if (thinking) assistant.content.unshift({ type: "thinking", thinking: "internal" });

    expect(filterContextMessages([assistant, result("failed", "read", "missing", true)], new Set(["failed"])))
      .toEqual({ changed: true, messages: [] });
  });

  it("reports no change when removed IDs do not occur in context", () => {
    const messages: ContextEvent["messages"] = [result("keep", "read", "source")];

    expect(filterContextMessages(messages, new Set(["absent"]))).toEqual({ changed: false, messages });
    expect(filterContextMessages(messages, new Set()).messages).toBe(messages);
  });
});

describe("history repair", () => {
  it("repairs parent chains and references across consecutive removed turns and sibling branches", () => {
    const root = entry("root", null, { role: "user", content: "request", timestamp: 0 });
    const assistant = assistantMessage("");
    assistant.content = [{ type: "toolCall", id: "failed", name: "read", arguments: {} }];
    const next = assistantMessage("");
    next.content = [{ type: "toolCall", id: "empty", name: "find", arguments: {} }];
    const entries = [
      root,
      entry("call", "root", assistant),
      entry("failed-result", "call", result("failed", "read", "missing", true)),
      entry("next-call", "failed-result", next),
      entry("empty-result", "next-call", result("empty", "find", "No files found matching pattern")),
      entry("reply", "empty-result", assistantMessage("kept")),
      entry("sibling", "failed-result", { role: "user", content: "branch", timestamp: 0 }),
      { type: "branch_summary", id: "summary", parentId: "reply", fromId: "empty-result", summary: "summary" },
      { type: "label", id: "label", parentId: "summary", targetId: "failed-result", label: "bookmark" },
      { type: "compaction", id: "compact", parentId: "label", firstKeptEntryId: "next-call", summary: "summary", tokensBefore: 100 },
    ];
    const original = structuredClone(entries);

    const cleaned = removeEntries(entries);

    expect(cleaned.changed).toBe(true);
    expect(cleaned.entries.map((item) => item.id)).toEqual(["root", "reply", "sibling", "summary", "label", "compact"]);
    expect(cleaned.entries.find((item) => item.id === "reply")?.parentId).toBe("root");
    expect(cleaned.entries.find((item) => item.id === "sibling")?.parentId).toBe("root");
    expect(cleaned.entries.find((item) => item.id === "summary")?.fromId).toBe("root");
    expect(cleaned.entries.find((item) => item.id === "label")?.targetId).toBe("root");
    expect(cleaned.entries.find((item) => item.id === "compact")?.firstKeptEntryId).toBe("root");
    expect(entries).toEqual(original);
    expect(removeEntries(cleaned.entries)).toMatchObject({ changed: false, entries: cleaned.entries });
  });

  it("retains mixed assistant turns and reparents surviving results to that turn", () => {
    const assistant = assistantMessage("keep explanation");
    assistant.content.push(
      { type: "toolCall", id: "failed", name: "read", arguments: {} },
      { type: "toolCall", id: "keep", name: "bash", arguments: {} },
    );
    const entries = [
      entry("call", null, assistant),
      entry("failed-result", "call", result("failed", "read", "missing", true)),
      entry("kept-result", "failed-result", result("keep", "bash", "exit 1", true)),
    ];

    expect(removeEntries(entries).entries).toEqual([
      entry("call", null, { ...assistant, content: [assistant.content[0]!, assistant.content[2]!] }),
      entry("kept-result", "call", result("keep", "bash", "exit 1", true)),
    ]);
  });

  it("reattaches surviving history to null when removed turn was the root", () => {
    const assistant = assistantMessage("");
    assistant.content = [{ type: "toolCall", id: "failed", name: "read", arguments: {} }];
    const entries = [
      entry("call", null, assistant),
      entry("failed-result", "call", result("failed", "read", "missing", true)),
      entry("reply", "failed-result", assistantMessage("kept")),
    ];

    expect(removeEntries(entries).entries).toEqual([entry("reply", null, assistantMessage("kept"))]);
  });
});
