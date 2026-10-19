import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { shouldRemoveToolCall } from "../../../src/optimizer/pruner/cleanup.js";

function result(toolCallId: string, toolName: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0,
  };
}

describe("prunable results", () => {
  it.each(["read", "inspect", "find", "edit"])("removes failed %s results", (toolName) => {
    expect(shouldRemoveToolCall(result("failed", toolName, "failure", true))).toBe(true);
  });

  it.each(["bash", "powershell", "codemode", "subagent"])("retains %s failures because their output remains useful", (toolName) => {
    expect(shouldRemoveToolCall(result("shell", toolName, "exit status 1", true))).toBe(false);
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
