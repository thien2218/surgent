import { SessionManager, type BashOperations, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bash from "../../../src/optimizer/reducer/bash.js";
import { recordExtension } from "../../helpers/extension.js";

const { exec } = vi.hoisted(() => ({ exec: vi.fn<BashOperations["exec"]>() }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, createLocalBashOperations: () => ({ exec }) };
});

beforeEach(() => { exec.mockReset(); });

async function reduce(chunks: Buffer[]) {
  exec.mockImplementation(async (_command, _cwd, options) => {
    for (const chunk of chunks) options.onData(chunk);
    return { exitCode: 0 };
  });
  const pi = recordExtension();
  bash(pi.api);
  const ctx = { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as unknown as ExtensionToolContext;
  const result = await pi.tool("bash").execute("stream", {
    command: "ignored", purpose: "Verify reduced output",
  }, undefined, undefined, ctx);
  expect(result.structuredContent).toMatchObject({ output: expect.any(String) });
  return (result.structuredContent as { output: string }).output;
}

describe("registered Bash output reduction", () => {
  it("preserves UTF-8, ANSI, and carriage returns across fragmented output", async () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m\r\nloading 1\rloading 2\r\nend");
    expect(await reduce([input])).toBe(input.toString());
    expect(await reduce(Array.from(input, (byte) => Buffer.from([byte])))).toBe(input.toString());
  });

  it("streams settled output before completion and flushes the pending tail once", async () => {
    const updates: string[] = [];
    exec.mockImplementation(async (_command, _cwd, options) => {
      options.onData(Buffer.from("first\nsecond line\npartial"));
      expect(updates.join("")).toContain("first");
      return { exitCode: 0 };
    });
    const pi = recordExtension();
    bash(pi.api);
    const ctx = { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as unknown as ExtensionToolContext;

    const result = await pi.tool("bash").execute("stream", {
      command: "ignored", purpose: "Verify streamed output",
    }, undefined, (update) => {
      updates.push(update.content.map((block) => block.type === "text" ? block.text : "").join(""));
    }, ctx);

    expect(result.structuredContent).toMatchObject({ output: "first\nsecond line\npartial" });
  });
});
