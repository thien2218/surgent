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
  const call = (toolName: string, input: unknown, parentToolCallId?: string) => extension.event("tool_call")({
    type: "tool_call", toolCallId: parentToolCallId ? `${parentToolCallId}/1` : "test-call", parentToolCallId, toolName, input,
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
    ["powershell", false], ["codemode", false], ["codemode", true],
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
      content: [{ type: "image", data: "A".repeat(64), mimeType: "image/png" }],
    } as ToolResultEvent;

    expect(await extension.event("tool_result")(event, ctx)).toEqual({ details: event.details, isError: false, content: event.content });
  });

  it.each([undefined, "parent"])("applies input blocking and structured redaction with ancestry %s", async (parentToolCallId) => {
    const { call, extension, ctx } = setup();
    expect(await call("write", { content: secret }, parentToolCallId)).toMatchObject({ block: true });
    expect(await call("edit", { edits: [{ newText: secret }] }, parentToolCallId)).toMatchObject({ block: true });
    expect(await call("write", { content: "safe" }, parentToolCallId)).toBeUndefined();
    const event: ToolResultEvent = {
      type: "tool_result", toolCallId: parentToolCallId ? `${parentToolCallId}/1` : "direct", parentToolCallId,
      toolName: "grep", input: {}, content: [{ type: "text", text: secret }], isError: true,
      structuredContent: { items: [secret, null, false, 42, { token: secret }], empty: [] },
      details: { source: "fixture" },
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const original = structuredClone(event);
    const result = await extension.event("tool_result")(event, ctx);
    expect(result).toMatchObject({
      content: [{ type: "text", text: marker }], isError: true,
      structuredContent: { items: [marker, null, false, 42, { token: marker }], empty: [] },
      details: event.details, usage: event.usage,
    });
    expect(event).toEqual(original);
  });

  it("preserves native read image bytes and redacts its note", async () => {
    const { extension, ctx } = setup();
    const image = { type: "image" as const, data: "A".repeat(64), mimeType: "image/png" };
    const event: ToolResultEvent = {
      type: "tool_result", toolName: "read", toolCallId: "image", input: {},
      content: [image], details: undefined, isError: false, structuredContent: { ...image, note: secret },
    };
    expect(await extension.event("tool_result")(event, ctx)).toMatchObject({
      content: [image], structuredContent: { ...image, note: marker }, isError: false,
    });
    expect(event.structuredContent).toEqual({ ...image, note: secret });
  });

  it("uses property names for contextual secret detection without changing keys", async () => {
    const { extension, ctx } = setup();
    const credential = "abcdefghijklmnopqrstuvwx";
    const event: ToolResultEvent = {
      type: "tool_result", toolName: "grep", toolCallId: "context", input: {}, content: [],
      details: undefined, isError: false, structuredContent: { nested: [{ client_secret: credential }], count: 1 },
    };
    expect(await extension.event("tool_result")(event, ctx)).toMatchObject({
      structuredContent: { nested: [{ client_secret: marker }], count: 1 },
    });
  });

  it("rejects cyclic data without returning or serializing the rejected value", async () => {
    const { extension, ctx } = setup();
    const value: Record<string, unknown> = { text: secret };
    value.self = value;
    const event = {
      type: "tool_result", toolName: "grep", toolCallId: "cycle", input: {},
      content: [], details: undefined, isError: false, structuredContent: value,
    } as ToolResultEvent;
    expect(await extension.event("tool_result")(event, ctx)).toMatchObject({ isError: true });
  });

  it.each([
    ["bash", { output: secret }],
    ["grep", { secret, invalid: undefined }],
    ["grep", { secret, invalid: Number.NaN }],
    ["grep", { secret, invalid: new Date() }],
    ["grep", { [secret]: 1 }],
    ["grep", [{ twilio: { auth_token: "a".repeat(32) } }]],
  ])("fails closed for malformed or unverifiable %s data", async (toolName, structuredContent) => {
    const { extension, ctx } = setup();
    const event = {
      type: "tool_result", toolName, toolCallId: "invalid", input: {},
      content: [{ type: "text", text: secret }], details: { source: "fixture" }, isError: false, structuredContent,
    } as ToolResultEvent;
    const result = await extension.event("tool_result")(event, ctx);
    expect(result).toMatchObject({ isError: true, details: event.details });
    expect(result).not.toHaveProperty("structuredContent");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).toMatchObject({ content: [{ type: "text", text: expect.stringContaining("rejected") }] });
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
