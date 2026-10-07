import { createBashToolDefinition, createReadToolDefinition, SessionManager, type ExtensionToolContext, type ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { readFile, rm } from "node:fs/promises";
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

it("limits grep context without settling itself", () => {
  const pi = recordExtension();
  reducerExtension(pi.api);

  expect(pi.tool("grep").parameters.properties.context).toMatchObject({ type: "number", maximum: 2 });
  expect(() => pi.event("agent_before_settle")).toThrow("Missing event registration");
});
