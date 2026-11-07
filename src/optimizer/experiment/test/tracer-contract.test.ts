import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import optimizer from "../../index.js";
import { recordExtension } from "../../../../test/helpers/extension.js";
import { useGrammarCache } from "../../../../test/helpers/languages.js";

useGrammarCache();

describe("registered call_tree", () => {
  it("registers the agreed schema with default depth three and minimum one", () => {
    const pi = recordExtension();
    optimizer(pi.api);

    const tool = pi.tool("call_tree");

    expect(tool.parameters.required).toEqual(["mode", "symbol", "file"]);
    expect(tool.parameters.properties.maxDepth).toMatchObject({ type: "integer", minimum: 1, default: 3 });
    expect(tool.parameters.properties).not.toHaveProperty("depth");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("reports invalid maxDepth %s as a tool error", async (maxDepth) => {
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("call_tree").execute("invalid", {
      mode: "outgoing", file: "main.ts", symbol: "root", maxDepth,
    }, undefined, undefined, { cwd: "/unused" } as ExtensionToolContext);

    expect(result).toMatchObject({ isError: true, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("maxDepth must be an integer of at least 1") }]);
  });

  it("rejects blank input before file discovery", async () => {
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("call_tree").execute("blank", {
      mode: "incoming", file: "main.ts", symbol: " ",
    }, undefined, undefined, { cwd: "/unused" } as ExtensionToolContext);

    expect(result).toMatchObject({ isError: true, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("file and symbol must be non-empty") }]);
  });

  it("returns a tree for normalized paths without requiring read-grant UI", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "surgent-call-tree-contract-"));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, "main.ts"), "function root() { leaf(); }\nfunction leaf() {}");
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("call_tree").execute("tree", {
      mode: "outgoing", file: "@./main.ts", symbol: " root ",
    }, undefined, undefined, { cwd } as ExtensionToolContext);

    expect(result).toMatchObject({ isError: false, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("root (F1 L1-L1) (outgoing)") }]);
  });
});
