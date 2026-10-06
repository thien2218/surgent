import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { getRemovedToolCallId } from "../../../src/optimizer/pruner/cleanup.js";

function result(toolCallId: string, toolName: string, text: string, isError = false): ToolResultMessage {
  return {
    role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0,
  };
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
