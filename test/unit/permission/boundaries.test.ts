import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentRules, expandFilePath, getRelativePathInRoot } from "../../../src/permission/resolution.js";

describe("permission path boundaries", () => {
  it.each(["..", "../permission-root-other/file.ts", "src/../../outside.ts", ""])(
    "does not auto-allow path %j inside the root",
    (path) => {
      expect(getRelativePathInRoot(path, resolve("permission-root"))).toBeNull();
    },
  );

  it("rejects an absolute sibling path sharing the root prefix", () => {
    expect(getRelativePathInRoot(resolve("permission-root-other/file.ts"), resolve("permission-root")))
      .toBeNull();
  });

  it.each([".", "src/.."])("accepts path %s resolving to the root itself", (path) => {
    expect(getRelativePathInRoot(path, resolve("permission-root"))).toBe("");
  });

  it("normalizes traversal that stays inside the root", () => {
    expect(getRelativePathInRoot("src/../docs/file.md", resolve("permission-root")))
      .toBe(join("docs", "file.md"));
  });

  it("expands home paths independently of cwd", () => {
    expect(expandFilePath("~", resolve("permission-root"))).toBe(homedir());
    expect(expandFilePath("~/docs/file.md", resolve("permission-root")))
      .toBe(join(homedir(), "docs", "file.md"));
    expect(getRelativePathInRoot("~/docs/file.md", homedir())).toBe(join("docs", "file.md"));
  });
});

describe("agent allowlist boundaries", () => {
  it.each([
    { inputs: ["docs:search", "docs:read"], allowed: true },
    { inputs: ["docs:search", "admin:delete"], allowed: false },
    { inputs: ["admin:delete", "docs:search"], allowed: false },
    { inputs: ["docs-other:search"], allowed: false },
  ])("requires every MCP input to match the server allowlist: $inputs", ({ inputs, allowed }) => {
    expect(checkAgentRules(
      { description: "test", mcp_tools: ["docs:*"] },
      { sessionId: "session-1", toolName: "call_mcp_tool", category: "mcp", raw: "", unresolved: inputs, purpose: "test" },
    )).toBe(allowed);
  });

  it("does not let read access authorize a write in a mixed request", () => {
    expect(checkAgentRules(
      { description: "test", "files.read": ["docs/**"], "files.write": ["src/**"] },
      {
        sessionId: "session-1", toolName: "edit", category: "file", raw: "", purpose: "test",
        unresolved: ["read:docs/a.md", "write:docs/a.md"],
      },
    )).toBe(false);
  });
});
