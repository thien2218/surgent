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
      const makeBlock = (startIndex: number, endIndex: number) => ({
        ...identifier,
        type: "statement_block", text: source.slice(startIndex, endIndex),
        startIndex, endIndex,
        children: [
          { ...identifier, type: "{", text: "{", startIndex, endIndex: startIndex + 1 },
          { ...identifier, type: "}", text: "}", startIndex: endIndex - 1, endIndex },
        ],
      });
      const bodyStart = source.indexOf("{", nameStart);
      const bodyEnd = source.lastIndexOf("}") + 1;
      const branchStart = source.indexOf("if (ready)");
      const branch = branchStart < 0 ? undefined : makeBlock(
        source.indexOf("{", branchStart), source.lastIndexOf("}", bodyEnd - 2) + 1,
      );
      const bodyChildren = branch ? [branch] : [];
      const body = {
        ...makeBlock(bodyStart, bodyEnd),
        namedChildren: bodyChildren, namedChildCount: bodyChildren.length,
        namedChild: (index: number) => bodyChildren[index] ?? null,
      };
      if (branch) branch.parent = body;
      const children = [identifier, body];
      const declaration = {
        type: "function_declaration", text: source, parent: null as unknown,
        namedChildren: children, namedChildCount: children.length,
        namedChild: (index: number) => children[index] ?? null,
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
      body.parent = declaration;
      declaration.parent = root;
      return { rootNode: root };
    }
  },
}));

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-inspector-contract-" });
  const grammar = join(workspace.home, ".pi", "agent", "grammars", "node_modules", "tree-sitter-typescript");
  await mkdir(grammar, { recursive: true });
  await writeFile(join(grammar, "package.json"), JSON.stringify({ name: "tree-sitter-typescript", type: "module", main: "index.js" }));
  await writeFile(join(grammar, "index.js"), "export const typescript = {};");
});

describe("registered inspect results", () => {
  const source = [
    "function handler() {",
    "  const value = { nested: { count: 1 } };",
    '  const text = "}";',
    "  // Braces in comments: { }",
    "  if (ready) {",
    "    work();",
    "  }",
    "}",
  ].join("\n");

  it("returns full source for normalized paths with no result identity metadata", async () => {
    await writeFile(join(workspace.cwd, "input.ts"), source);
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("body", {
      path: "@./input.ts", symbol: " handler ",
    }, undefined, undefined, makePermissionContext(workspace.cwd));

    expect(result).toMatchObject({ isError: false, details: null, content: [{ type: "text", text: source }] });
  });

  it.each([
    { depth: 0, expected: "function handler() { ... }" },
    { depth: 1, expected: source.replace("if (ready) {\n    work();\n  }", "if (ready) { ... }") },
    { depth: 2, expected: source },
  ])("limits code blocks at depth $depth while preserving source outside them", async ({ depth, expected }) => {
    await writeFile(join(workspace.cwd, "input.ts"), source);
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("depth", {
      path: "input.ts", symbol: "handler", depth,
    }, undefined, undefined, makePermissionContext(workspace.cwd));

    expect(result).toEqual({ isError: false, details: null, content: [{ type: "text", text: expected }] });
  });

  it("marks invalid symbols as errors", async () => {
    const pi = recordExtension();
    optimizer(pi.api);

    const result = await pi.tool("inspect").execute("invalid", { path: "input.ts", symbol: " " }, undefined, undefined, makePermissionContext(workspace.cwd));

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
