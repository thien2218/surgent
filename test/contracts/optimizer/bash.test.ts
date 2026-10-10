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

// Reference expansion of the model-facing text format.
function expand(text: string) {
  return (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => {
    const markers = /\\[{}]|{([A-Za-z0-9]+(?:, [A-Za-z0-9]+)+)}/g;
    const values = Array.from(line.matchAll(markers)).find((match) => match[1]);
    if (!values) return line.replace(/\\([{}])/g, "$1");
    return values[1]!.split(", ").map((value) =>
      line.replace(markers, (marker, list) => list ? value : marker.slice(1)),
    ).join("");
  }).join("");
}

describe("registered Bash output reduction", () => {
  it("preserves UTF-8, ANSI, and carriage returns across fragmented output", async () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m\r\nloading 1\rloading 2\r\nend");
    expect(await reduce([input])).toBe(input.toString());
    expect(await reduce(Array.from(input, (byte) => Buffer.from([byte])))).toBe(input.toString());
  });

  it.each([
    ["status 204\nstatus 404\nstatus 404\nstatus 500\n", "status {204, 404, 404, 500}\n"],
    ["Downloading package 100\n".repeat(3) + "OK\nDownloading package 100\n", "Downloading package {100, 100, 100}\nOK\nDownloading package 100\n"],
    ["1\n2\nsame\nsame\nGET /api/post/ resolves to 204\nGET /api/post/ resolves to 404", "1\n2\nsame\nsame\nGET /api/post/ resolves to 204\nGET /api/post/ resolves to 404"],
    ["GET /api/{post}/ resolves to {204}\nGET /api/{post}/ resolves to {404}\nliteral {204, 404}\n100%", "GET /api/\\{post\\}/ resolves to \\{{204, 404}\\}\nliteral \\{204, 404\\}\n100%"],
    ["status 204\nstatus 404\nother 500\nother 501\r\nother 502!\r\n", "status {204, 404}\nother 500\nother 501\r\nother 502!\r\n"],
  ])("preserves grouping boundaries and escaping for %j", async (input, expected) => {
    const output = await reduce([Buffer.from(input)]);
    expect(output).toBe(expected);
    expect(expand(output)).toBe(input);
  });

  it("keeps long grouped runs lossless", async () => {
    const input = "GET /api/post/ resolves to 204\n".repeat(3000);
    expect(expand(await reduce([Buffer.from(input)]))).toBe(input);
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
