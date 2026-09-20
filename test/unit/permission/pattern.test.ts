import { describe, expect, it } from "vitest";
import { filePathToPattern, toPattern, urlToPattern } from "../../../src/permission/pattern.js";

describe("filePathToPattern", () => {
  it.each([
    ["", ""],
    ["src/", "src/"],
    ["README", "*"],
    ["index.ts", "*.ts"],
    ["archive.tar.gz", "*.gz"],
    [".env", ".*"],
    [".env.local", ".*.local"],
    ["src/index.ts", "src/*.ts"],
    ["src/lib/index.ts", "src/lib/*.ts"],
    ["src/lib/deep/index.ts", "src/lib/deep/**"],
    ["/workspace/src/index.ts", "/workspace/src/*.ts"],
  ])("converts %j to %j", (path, expected) => {
    expect(filePathToPattern(path)).toBe(expected);
  });
});

describe("urlToPattern", () => {
  it("reduces a URL to its origin", () => {
    expect(urlToPattern("https://example.com/path?q=1#result")).toBe("https://example.com/**");
    expect(urlToPattern("http://example.com:8080/path")).toBe("http://example.com:8080/**");
  });

  it("preserves empty and unparsable input", () => {
    expect(urlToPattern("")).toBe("");
    expect(urlToPattern("not a url")).toBe("not a url");
  });
});

describe("toPattern", () => {
  it.each([
    ["read", "src/index.ts\nignored.ts", "src/*.ts"],
    ["write", "src/index.ts\r\nignored.ts", "src/*.ts"],
    ["edit", "README\rignored", "*"],
    ["grep", "src/", "src/"],
    ["web_fetch", "https://example.com/a\nhttps://other.test", "https://example.com/**"],
    ["bash", "git status\necho ok", "git status *"],
    ["call_mcp_tool", "github:search", "github:search"],
  ] as const)("routes %s input to its pattern converter", (toolName, input, expected) => {
    expect(toPattern(toolName, input)).toBe(expected);
  });
});
