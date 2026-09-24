import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filePathToPattern, toPatterns } from "../../../src/permission/pattern.js";
import type { FileOp } from "../../../src/permission/types.js";

describe("suggested permission patterns", () => {
  it.each<{ operation: FileOp; path: string; expected: string }>([
    { operation: "read", path: "src/main.ts", expected: "read:src/*.ts" },
    { operation: "write", path: "config.ts", expected: "write:*.ts" },
    { operation: "read", path: ".env", expected: "read:.*" },
    { operation: "write", path: "src/.env.local", expected: "write:src/.*.local" },
    { operation: "read", path: "src/one/two/file.ts", expected: "read:src/one/two/**" },
    { operation: "read", path: "src/", expected: "read:src/" },
    { operation: "read", path: "src/main.ts\r\nwrite:private.txt", expected: "read:src/*.txt" },
    { operation: "read", path: "src/main.ts\rwrite:private.txt", expected: "read:src/*.txt" },
  ])("derives $expected from the complete path $path", ({ operation, path, expected }) => {
    expect(toPatterns({
      sessionId: "session-1", toolName: operation, category: "file", raw: path, purpose: "test",
      operation, relative: path, absolute: resolve(path),
    })).toEqual([expected]);
  });

  it("keeps root hidden-file suggestions limited to hidden files", () => {
    expect(filePathToPattern(".env")).toBe(".*");
  });

  it.each([
    ["https://EXAMPLE.com:443/docs?q=test#heading", "https://example.com/**"],
    ["https://example.com:8443/docs", "https://example.com:8443/**"],
  ])("scopes URL %s to its normalized origin", (raw, expected) => {
    expect(toPatterns({ sessionId: "session-1", toolName: "web_fetch", category: "web", raw, purpose: "test" }))
      .toEqual([expected]);
  });

  it.each([
    ["git status --short", "git status *"],
    ["pnpm test", "pnpm *"],
    ["pwd", "pwd"],
    ["echo '", "echo '"],
  ])("derives bash pattern for %s", (raw, expected) => {
    expect(toPatterns({ sessionId: "session-1", toolName: "bash", category: "bash", raw, unresolved: [raw], purpose: "test" }))
      .toEqual([expected]);
  });

  it("keeps MCP permissions scoped to the exact server and tool", () => {
    expect(toPatterns({ sessionId: "session-1", toolName: "call_mcp_tool", category: "mcp", raw: "docs:search", purpose: "test" }))
      .toEqual(["docs:search"]);
  });
});
