import { describe, expect, it } from "vitest";
import { filePathToPattern, toPattern } from "../../../src/permission/pattern.js";

describe("suggested permission patterns", () => {
  it.each([
    ["read:src/main.ts", "read:src/*.ts"],
    ["write:config.ts", "write:*.ts"],
    ["read:.env", "read:.*"],
    ["write:src/.env.local", "write:src/.*.local"],
    ["read:src/one/two/file.ts", "read:src/one/two/**"],
    ["read:src/", "read:src/"],
    ["read:src/main.ts\r\nwrite:private.txt", "read:src/*.ts"],
    ["read:src/main.ts\rwrite:private.txt", "read:src/*.ts"],
  ])("derives %s without broadening beyond %s", (input, expected) => {
    expect(toPattern("read", input)).toBe(expected);
  });

  it("keeps root hidden-file suggestions limited to hidden files", () => {
    expect(filePathToPattern(".env")).toBe(".*");
  });

  it("normalizes URL origin without retaining path, query, or fragment", () => {
    expect(toPattern("web_fetch", "https://EXAMPLE.com:443/docs?q=test#heading"))
      .toBe("https://example.com/**");
  });

  it("keeps non-default URL ports distinct", () => {
    expect(toPattern("web_fetch", "https://example.com:8443/docs"))
      .toBe("https://example.com:8443/**");
  });

  it.each([
    ["git status --short", "git status *"],
    ["pnpm test", "pnpm *"],
    ["pwd", "pwd"],
    ["echo '", "echo '"],
  ])("derives bash pattern for %s", (input, expected) => {
    expect(toPattern("bash", input)).toBe(expected);
  });

  it("keeps MCP permissions scoped to the exact server and tool", () => {
    expect(toPattern("call_mcp_tool", "docs:search")).toBe("docs:search");
  });
});
