import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import redactor from "../../../src/redactor/index.js";
import { recordExtension } from "../../helpers/extension.js";

const secret = `ghp_${"a".repeat(36)}`;
const marker = "(redacted texts)";

function setup() {
  const extension = recordExtension();
  redactor(extension.api);
  const ctx = {} as ExtensionContext;
  const call = (toolName: string, input: unknown) => extension.event("tool_call")({
    type: "tool_call", toolCallId: "test-call", toolName, input,
  } as ToolCallEvent, ctx);
  return { extension, ctx, call };
}

describe("secret-bearing tool calls", () => {
  it("blocks a secret-bearing write without echoing its content or mutating input", async () => {
    const { call } = setup();
    const input = { path: "fake.txt", content: `before ${secret} after` };

    const result = await call("write", input);

    expect(result).toEqual({ block: true, reason: "Secrets detected in content to be written" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(input.content).toBe(`before ${secret} after`);
  });

  it.each([0, 1, 2])("blocks the entire edit batch when edit %s introduces a secret", async (position) => {
    const { call } = setup();
    const edits = [0, 1, 2].map((index) => ({ oldText: `old ${index}`, newText: index === position ? secret : "safe" }));

    const result = await call("edit", { path: "fake.txt", edits });

    expect(result).toEqual({ block: true, reason: "Secrets detected in edit content" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(edits[position]?.newText).toBe(secret);
  });

  it("allows removal of a secret present only in oldText", async () => {
    const { call } = setup();
    expect(await call("edit", { path: "fake.txt", edits: [{ oldText: secret, newText: "safe" }] })).toBeUndefined();
  });

  it.each([
    ["write", { content: "safe text" }],
    ["write", { content: "" }],
    ["edit", { edits: [] }],
    ["edit", { edits: [{ oldText: "remove", newText: "" }] }],
  ])("allows safe or empty replacement content for %s: %j", async (toolName, input) => {
    const { call } = setup();
    expect(await call(toolName as string, input)).toBeUndefined();
  });

  it.each([
    ["write", {}], ["edit", {}], ["edit", { edits: [{}] }],
    ["write", null], ["write", []], ["write", "invalid"],
    ["write", { content: null }], ["write", { content: 123 }], ["write", { content: [secret] }],
    ["edit", null], ["edit", { edits: null }], ["edit", { edits: {} }], ["edit", { edits: secret }],
    ["edit", { edits: [null] }], ["edit", { edits: [secret] }], ["edit", { edits: [[]] }],
    ["edit", { edits: [{ newText: null }] }], ["edit", { edits: [{ newText: [secret] }] }],
    ["edit", { edits: [{ newText: 123 }] }],
  ])("fails closed for malformed %s input: %j", async (toolName, input) => {
    const { call } = setup();
    const result = await call(toolName as string, input);
    expect(result).toMatchObject({ block: true });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each(["read", "bash", "grep", "custom"])("does not change unrelated %s calls", async (toolName) => {
    const { call } = setup();
    expect(await call(toolName, { content: secret, edits: [{ newText: secret }] })).toBeUndefined();
  });
});

describe("tool-result redaction", () => {
  it.each([
    ["read", false], ["read", true],
    ["bash", false], ["bash", true],
    ["grep", false], ["grep", true],
  ] as const)("redacts every text block in %s results with isError=%s", async (toolName, isError) => {
    const { extension, ctx } = setup();
    const image = { type: "image", data: "ZmFrZQ==", mimeType: "image/png" } as const;
    const event = {
      type: "tool_result", toolCallId: "test-result", toolName, input: {}, isError,
      details: { source: "fake.txt" },
      content: [
        { type: "text", text: `before ${secret}`, extra: "preserved" },
        image,
        { type: "text", text: `${secret} after` },
        { type: "text", text: "safe text" },
      ],
    } as ToolResultEvent;

    const result = await extension.event("tool_result")(event, ctx);

    expect(result).toEqual({
      details: event.details, isError,
      content: [
        { type: "text", text: `before ${marker}`, extra: "preserved" },
        image,
        { type: "text", text: `${marker} after` },
        { type: "text", text: "safe text" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(event.content[0]).toMatchObject({ text: `before ${secret}` });
  });

  it.each([{ content: [] }, { content: [{ type: "text", text: "" }] }])("preserves empty content: $content", async ({ content }) => {
    const { extension, ctx } = setup();
    const event = { type: "tool_result", toolCallId: "empty", toolName: "read", input: {}, content, details: undefined, isError: false } as ToolResultEvent;
    expect(await extension.event("tool_result")(event, ctx)).toEqual({ content, details: undefined, isError: false });
  });

  it("leaves details and non-text blocks outside the text-redaction boundary", async () => {
    const { extension, ctx } = setup();
    const event = {
      type: "tool_result", toolCallId: "boundary", toolName: "read", input: {}, isError: false,
      details: { unfiltered: secret },
      content: [{ type: "image", data: secret, mimeType: "image/png" }],
    } as ToolResultEvent;

    expect(await extension.event("tool_result")(event, ctx)).toEqual({ details: event.details, isError: false, content: event.content });
  });

  it.each(["write", "edit", "find", "ls", "custom"])("does not transform unsupported %s results", async (toolName) => {
    const { extension, ctx } = setup();
    const event = {
      type: "tool_result", toolCallId: "unsupported", toolName, input: {}, isError: false,
      content: [{ type: "text", text: secret }], details: undefined,
    } as ToolResultEvent;
    expect(await extension.event("tool_result")(event, ctx)).toBeUndefined();
  });
});
