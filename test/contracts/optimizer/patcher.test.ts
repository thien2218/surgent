import { generateDiffString, initTheme, type ExtensionToolContext, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import optimizer from "../../../src/optimizer/index.js";
import { recordExtension } from "../../helpers/extension.js";

beforeAll(() => { initTheme("dark", false); });

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

function setup() {
  const extension = recordExtension();
  optimizer(extension.api);
  const tool = extension.tool("apply_patch");
  const theme = { fg: (_color: string, text: string) => text } as Theme;
  type CallOptions = Parameters<NonNullable<typeof tool.renderCall>>[2];
  type ResultContext = Parameters<NonNullable<typeof tool.renderResult>>[3];
  const renderCall = (args: Record<string, unknown>, isPartial = false) =>
    text(tool.renderCall?.(args, theme, { isPartial } as CallOptions));
  const renderResult = (result: Record<string, unknown>, isError = false) =>
    text(tool.renderResult?.(
      { content: [], details: undefined, ...result }, { isPartial: false, expanded: false }, theme,
      { isError } as ResultContext,
    ));
  return { tool, renderCall, renderResult };
}

function text(component: { render(width: number): string[] } | undefined) {
  return stripTerminalSequences(component?.render(120).join("\n") ?? "").trimEnd();
}

describe("apply_patch registration", () => {
  it("registers apply_patch with a required patchText string and the patch envelope", () => {
    const { tool } = setup();

    expect(tool.parameters).toMatchObject({
      type: "object", required: ["patchText"], properties: { patchText: { type: "string" } },
    });
    expect(tool.description).toContain("*** Begin Patch");
    expect(tool.description).toContain("*** Update File: <path>");
  });

  it.each([
    ["", "patchText is required"],
    ["*** Add File: a.txt\n+x", "apply_patch verification failed: Error: Invalid patch format: missing Begin/End markers"],
    [patch(), "patch rejected: empty patch"],
    ["*** Begin Patch\r\n*** End Patch\r\n", "patch rejected: empty patch"],
    [patch("not a header"), "apply_patch verification failed: no hunks found"],
  ])("rejects %j before reading the session context", async (patchText, message) => {
    const { tool } = setup();
    const ctx = new Proxy({}, {
      get(_target, property) { throw new Error(`Unexpected context access: ${String(property)}`); },
    }) as ExtensionToolContext;

    await expect(tool.execute("call", { patchText }, undefined, undefined, ctx)).rejects.toThrow(message);
  });
});

describe("apply_patch rendering", () => {
  it.each([false, true])("lists every file header in the call with partial=%s", (isPartial) => {
    const { renderCall } = setup();
    const patchText = patch(
      "*** Update File: src/a.ts", "*** Move to: src/b.ts", "@@", "-x", "+y",
      "*** Add File: c.txt", "+z",
      "*** Delete File: d.txt",
    );

    expect(renderCall({ patchText }, isPartial)).toBe("apply_patch src/a.ts, c.txt, d.txt");
  });

  it.each([
    [{}, "apply_patch"],
    [{ patchText: "*** Begin Patch\n*** Update File: src/a" }, "apply_patch src/a"],
  ])("renders streaming arguments %j", (args, expected) => {
    const { renderCall } = setup();
    expect(renderCall(args, true)).toBe(expected);
  });

  it("renders each changed file with its summary code and diff", () => {
    const { renderResult } = setup();
    const files = [
      { type: "update", path: "a.txt", diff: generateDiffString("one\n", "two\n").diff },
      { type: "move", path: "moved.txt", diff: generateDiffString("old\n", "new\n").diff },
      { type: "add", path: "added.txt", diff: generateDiffString("", "fresh\n").diff },
      { type: "delete", path: "gone.txt", diff: generateDiffString("gone\n", "").diff },
    ];

    const output = renderResult({ details: { files } });

    for (const expected of ["M a.txt", "one", "two", "M moved.txt", "A added.txt", "fresh", "D gone.txt", "gone"]) {
      expect(output).toContain(expected);
    }
  });

  it("renders the error text for a failed call and nothing without details", () => {
    const { renderResult } = setup();
    const content = [{ type: "text", text: "apply_patch verification failed: no hunks found" }];

    expect(renderResult({ content }, true)).toBe("apply_patch verification failed: no hunks found");
    expect(renderResult({})).toBe("");
  });
});
