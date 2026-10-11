import { createBashToolDefinition, createReadToolDefinition, SessionManager, type ExtensionToolContext, type ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { readFile, rm, writeFile } from "node:fs/promises";
import { beforeEach, expect, it, onTestFinished } from "vitest";
import { Check } from "typebox/value";
import redactor from "../../../src/redactor/index.js";
import reducerExtension from "../../../src/optimizer/reducer/index.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

beforeEach(async () => {
  await createWorkspace({ prefix: "surgent-reducer-contract-", changeCwd: true });
});

it("advertises native structured Bash with a required purpose", () => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  const bash = pi.tool("bash");

  expect(bash.outputSchema).toEqual(createBashToolDefinition(process.cwd()).outputSchema);
  expect(bash.prepareArguments).toBeUndefined();
  expect(bash.parameters.required).toContain("purpose");
  expect(bash.parameters.properties.purpose).toMatchObject({ type: "string", minLength: 1, maxLength: 256, pattern: "\\S" });
});

it.each([
  ["printf 'safe'", "safe", 0],
  ["true", "", 0],
  [`printf 'ghp_${"a".repeat(36)}'; exit 7`, "(redacted texts)", 7],
])("returns schema-valid, redacted Bash data for %s", async (command, output, exitCode) => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  redactor(pi.api);
  const bash = pi.tool("bash");
  const ctx = { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as unknown as ExtensionToolContext;
  const raw = await bash.execute("shell", { command, purpose: "Test native result" }, undefined, undefined, ctx);
  const result = await pi.event("tool_result")({
    ...raw, type: "tool_result", toolName: "bash", toolCallId: "shell", input: {}, isError: raw.isError ?? false,
  }, ctx) as ToolResultEventResult;
  expect(Check(bash.outputSchema!, result.structuredContent)).toBe(true);
  expect(result.structuredContent).toMatchObject({ output, exit_code: exitCode, truncated: false, wall_time_seconds: expect.any(Number) });
  expect(result.isError).toBe(exitCode !== 0);
  expect(JSON.stringify(result)).not.toContain(`ghp_${"a".repeat(36)}`);
});

it("retains native truncation metadata without claiming the full-output file is redacted", async () => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  redactor(pi.api);
  const bash = pi.tool("bash");
  const ctx = { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as unknown as ExtensionToolContext;
  const secret = `ghp_${"a".repeat(36)}`;
  const raw = await bash.execute("large", {
    command: `printf '${secret}\\n'; head -c 1100000 /dev/zero | tr '\\0' 'x'; printf '\\n${secret}\\n'`, purpose: "Test truncation",
  }, undefined, undefined, ctx);
  const path = raw.details?.fullOutputPath as string;
  onTestFinished(() => rm(path, { force: true }));
  const result = await pi.event("tool_result")({
    ...raw, type: "tool_result", toolName: "bash", toolCallId: "large", input: {}, isError: false,
  }, ctx) as ToolResultEventResult;
  expect(Check(bash.outputSchema!, result.structuredContent)).toBe(true);
  expect(result.structuredContent).toMatchObject({ truncated: true, full_output_path: path, exit_code: 0 });
  expect(result.details).toEqual(raw.details);
  expect(JSON.stringify([result.content, result.structuredContent]).includes(secret)).toBe(false);
  expect(await readFile(path, "utf8")).toContain(secret);
  const read = await createReadToolDefinition(process.cwd()).execute("read-output", { path, limit: 1 }, undefined, undefined, ctx);
  const safeRead = await pi.event("tool_result")({
    ...read, type: "tool_result", toolName: "read", toolCallId: "read-output", input: { path }, isError: false,
  }, ctx) as ToolResultEventResult;
  expect(JSON.stringify([safeRead.content, safeRead.structuredContent]).includes(secret)).toBe(false);
  expect(safeRead.structuredContent).toContain("(redacted texts)");
});

it("preserves native cancellation instead of fabricating structured success", async () => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  const ctx = { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as unknown as ExtensionToolContext;
  await expect(pi.tool("bash").execute("cancelled", { command: "printf safe", purpose: "Test abort" },
    AbortSignal.abort(), undefined, ctx)).rejects.toThrow("Command aborted");
});

it.each([
  { name: "whole file", text: "first\nsecond", args: {}, fullFile: true },
  { name: "empty file", text: "", args: {}, fullFile: true },
  { name: "limit reaches EOF", text: "first\nsecond", args: { offset: 1, limit: 2 }, fullFile: true },
  { name: "partial limit", text: "first\nsecond", args: { limit: 1 }, fullFile: false },
  { name: "partial offset", text: "first\nsecond", args: { offset: 2 }, fullFile: false },
  { name: "line truncation", text: "line\n".repeat(2001), args: {}, fullFile: false },
  { name: "byte truncation", text: "x".repeat(51201), args: {}, fullFile: false },
])("records read completeness for $name", async ({ text, args, fullFile }) => {
  await writeFile("input.txt", text);
  const pi = recordExtension({ getSettings: () => ({}) });
  reducerExtension(pi.api);
  const ctx = { cwd: process.cwd() } as ExtensionToolContext;

  const result = await pi.tool("read").execute("read", { path: "input.txt", ...args }, undefined, undefined, ctx);

  expect(result.details.fullFile).toBe(fullFile);
});

it("does not mark image attachments as full text snapshots", async () => {
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ6MAAAAASUVORK5CYII=", "base64");
  await writeFile("input.png", image);
  const pi = recordExtension({ getSettings: () => ({ images: { autoResize: false } }) });
  reducerExtension(pi.api);
  const ctx = { cwd: process.cwd() } as ExtensionToolContext;

  const result = await pi.tool("read").execute("image", { path: "input.png" }, undefined, undefined, ctx);

  expect(result.details.fullFile).toBe(false);
  expect(result.content).toContainEqual({ type: "image", data: image.toString("base64"), mimeType: "image/png" });
});

it("allows up to two grep context lines", () => {
  const pi = recordExtension();
  reducerExtension(pi.api);
  const grep = pi.tool("grep");

  expect(grep.parameters.properties.context).toMatchObject({ type: "number", maximum: 2 });
  expect(Check(grep.parameters, { pattern: "match", context: 2 })).toBe(true);
  expect(Check(grep.parameters, { pattern: "match", context: 3 })).toBe(false);
});
