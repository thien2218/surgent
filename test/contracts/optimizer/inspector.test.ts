import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import optimizer from "../../../src/optimizer/index.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionContext } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

vi.mock("tree-sitter", () => ({
  default: class {
    setLanguage() {}

    parse(source: string) {
      const nameStart = source.indexOf("handler");
      const identifier = {
        type: "identifier", text: "handler", parent: null as unknown,
        namedChildren: [], namedChildCount: 0,
        namedChild: () => null, childForFieldName: () => null,
        startIndex: nameStart, endIndex: nameStart + 7,
        startPosition: { row: 0, column: nameStart }, endPosition: { row: 0, column: nameStart + 7 },
      };
      const declaration = {
        type: "function_declaration", text: source, parent: null as unknown,
        namedChildren: [identifier], namedChildCount: 1,
        namedChild: () => identifier,
        childForFieldName: (field: string) => field === "name" ? identifier : null,
        startIndex: 0, endIndex: source.length,
        startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: source.length },
      };
      const root = {
        type: "program", text: source, parent: null,
        namedChildren: [declaration], namedChildCount: 1,
        namedChild: () => declaration, childForFieldName: () => null,
        startIndex: 0, endIndex: source.length,
        startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: source.length },
      };
      identifier.parent = declaration;
      declaration.parent = root;
      return { rootNode: root };
    }
  },
}));

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-inspector-contract-" });
});

describe("registered inspect results", () => {
  it("returns the requested body with no result identity metadata", async () => {
    const source = "function handler() {}";
    await writeFile(join(workspace.cwd, "input.ts"), source);
    const grammar = join(workspace.home, ".pi", "agent", "grammars", "node_modules", "tree-sitter-typescript");
    await mkdir(grammar, { recursive: true });
    await writeFile(join(grammar, "package.json"), JSON.stringify({ name: "tree-sitter-typescript", type: "module", main: "index.js" }));
    await writeFile(join(grammar, "index.js"), "export const typescript = {};");
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("body", {
      path: " ./input.ts ", symbol: " handler ",
    }, undefined, undefined, makePermissionContext(workspace.cwd));

    expect(result).toMatchObject({ isError: false, details: null, content: [{ type: "text", text: source }] });
  });

  it.each([
    { path: "", symbol: "handler" },
    { path: "input.ts", symbol: " " },
    { path: "input.ts", symbol: "handler#" },
  ])("marks invalid symbol requests as errors (%j)", async (args) => {
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("invalid", args, undefined, undefined, makePermissionContext(workspace.cwd));

    expect(result).toMatchObject({ isError: true, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("inspect symbol format invalid") }]);
  });

  it("marks symbol-not-found results as errors", async () => {
    await writeFile(join(workspace.cwd, "input.txt"), "plain text");
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("missing", {
      path: "input.txt", symbol: "handler",
    }, undefined, undefined, makePermissionContext(workspace.cwd));

    expect(result).toMatchObject({ isError: true, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("inspect symbol not found") }]);
  });

  it("marks aborted lookups as errors instead of successful bodies", async () => {
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("aborted", {
      path: "input.ts", symbol: "handler",
    }, AbortSignal.abort(), undefined, makePermissionContext(workspace.cwd));

    expect(result).toMatchObject({ isError: true, details: null });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("inspect failed: inspector aborted") }]);
  });
});
