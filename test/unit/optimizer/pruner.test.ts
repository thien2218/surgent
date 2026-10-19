import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { shouldRemoveToolCall } from "../../../src/optimizer/pruner/cleanup.js";

function result(toolCallId: string, toolName: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0, durationMs: 0,
  };
}

function blocked(toolName: string, text: string): ToolResultMessage {
  const message = result("blocked", toolName, text, true);
  delete message.durationMs;
  return message;
}

describe("prunable results", () => {
  it.each(["read", "inspect", "find", "edit"])("removes failed %s results", (toolName) => {
    expect(shouldRemoveToolCall(result("failed", toolName, "failure", true))).toBe(true);
  });

  it.each(["bash", "powershell", "codemode", "subagent"])("retains %s failures because their output remains useful", (toolName) => {
    expect(shouldRemoveToolCall(result("shell", toolName, "exit status 1", true))).toBe(false);
  });

  it.each([
    ["read", "User rejected this tool call. Find a different approach. User input: use the fixture"],
    ["edit", "Access to this resource is denied by policy rule: deny"],
    ["read", 'Path blocked by .piignore rule ".env"'],
    ["bash", "Permission request was cancelled"],
  ])("retains blocked %s calls: %s", (toolName, text) => {
    expect(shouldRemoveToolCall(blocked(toolName, text))).toBe(false);
  });

  it.each([
    'Tool "missing" not found',
    "Tool missing not found",
    'Validation failed for tool "read":\n  - path: must be string',
    'Invalid arguments for tool "read": Unexpected end of JSON input',
    "Operation aborted",
    'Tool call "read" was not executed: the response hit the output token limit',
  ])("removes unexecuted calls the agent loop rejected: %s", (text) => {
    expect(shouldRemoveToolCall(blocked("read", text))).toBe(true);
  });

  it.each([
    ["ls", "(empty directory)"],
    ["find", "No files found matching pattern"],
    ["find", "No changes found."],
    ["find", "No changes in selected files."],
  ])("removes empty %s output: %s", (toolName, text) => {
    expect(shouldRemoveToolCall(result("empty", toolName, text))).toBe(true);
  });

  it.each([
    ["read", "(empty directory)"],
    ["bash", "No files found matching pattern"],
    ["find", "No files found matching pattern\nadditional information"],
    ["ls", ""],
    ["find", "source.ts"],
  ])("preserves meaningful %s output: %s", (toolName, text) => {
    expect(shouldRemoveToolCall(result("keep", toolName, text))).toBe(false);
  });

  it("preserves empty-looking text accompanied by other output", () => {
    const message = result("keep", "find", "No files found matching pattern");
    message.content.push({ type: "text", text: "diagnostic" });

    expect(shouldRemoveToolCall(message)).toBe(false);
  });
});
