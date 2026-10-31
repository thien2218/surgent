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
  it("renders terminal text and preserves UTF-8 across fragmented output", async () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m  \r\nloading 1\rloading 2\r\nvoilà \t\nÛm {braces}");
    const expected = "café 🦊\r\nloading 2\r\nvoilà\nÛm {braces}";
    expect(await reduce([input])).toBe(expected);
    expect(await reduce(Array.from(input, (byte) => Buffer.from([byte])))).toBe(expected);
  });

  it.each([
    ["Downloading 10%\r\u001b[KDownloading 100%\n", "Downloading 100%\n"],
    ["\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n", "link\n"],
    ["done\r", "done"],
    ["Downloading package 100\n".repeat(3) + "OK\n", "Downloading package 100\n[above line repeated 2 more times]\nOK\n"],
    ["same\nsame\nother\r\nother\n", "same\nsame\nother\r\nother\n"],
    ["warning: request retried\n".repeat(4) + "warning: request retried", "warning: request retried\n[above line repeated 3 more times]\nwarning: request retried"],
  ])("reduces %j", async (input, expected) => {
    expect(await reduce([Buffer.from(input)])).toBe(expected);
  });

  it("collapses long repeated runs into one marker", async () => {
    const line = "GET /api/post/ resolves to 204\n";
    expect(await reduce([Buffer.from(line.repeat(3000))])).toBe(`${line}[above line repeated 2999 more times]\n`);
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
