import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentRules, expandFilePath, isRelativeToRoot } from "../../../src/permission/resolution.js";

describe("permission path boundaries", () => {
  it.each(["..", "../permission-root-other/file.ts", "src/../../outside.ts"])(
    "rejects path %j outside the root", (path) => {
      expect(isRelativeToRoot(resolve("permission-root", path), resolve("permission-root"))).toBe(false);
    },
  );

  it("rejects an absolute sibling path sharing the root prefix", () => {
    expect(isRelativeToRoot(resolve("permission-root-other/file.ts"), resolve("permission-root"))).toBe(false);
  });

  it.each([".", "src/..", "src/../docs/file.md"])("accepts path %s resolving inside the root", (path) => {
    expect(isRelativeToRoot(resolve("permission-root", path), resolve("permission-root"))).toBe(true);
  });

  it("rejects an empty path before resolution", () => {
    expect(expandFilePath("", resolve("permission-root"))).toBeNull();
  });

  it("expands home paths independently of cwd", () => {
    expect(expandFilePath("~", resolve("permission-root"))).toBe(homedir());
    expect(expandFilePath("~/docs/file.md", resolve("permission-root"))).toBe(join(homedir(), "docs", "file.md"));
  });
});

describe("agent allowlist boundaries", () => {
  it.each([
    { raw: "docs:search", allowed: true },
    { raw: "docs:read", allowed: true },
    { raw: "admin:delete", allowed: false },
    { raw: "docs-other:search", allowed: false },
  ])("checks MCP resource $raw against the server allowlist", ({ raw, allowed }) => {
    expect(checkAgentRules(
      { description: "test", mcp_tools: ["docs:*"] },
      { sessionId: "session-1", toolName: "call_mcp_tool", category: "mcp", raw, purpose: "test" },
    )).toBe(allowed);
  });

  it.each(["read", "write"] as const)("uses the %s allowlist for a file operation", (operation) => {
    expect(checkAgentRules(
      { description: "test", "files.read": ["docs/**"], "files.write": ["src/**"] },
      {
        sessionId: "session-1", toolName: operation, category: "file", raw: "docs/a.md", purpose: "test",
        operation, relative: "docs/a.md", absolute: resolve("docs/a.md"),
      },
    )).toBe(operation === "read");
  });

  it.each(["docs/**", resolve("docs", "**")])("accepts a matching relative or absolute allowlist %s", (pattern) => {
    expect(checkAgentRules(
      { description: "test", "files.read": [pattern] },
      {
        sessionId: "session-1", toolName: "read", category: "file", raw: "docs/a.md", purpose: "test",
        operation: "read", relative: "docs/a.md", absolute: resolve("docs/a.md"),
      },
    )).toBe(true);
  });
});
