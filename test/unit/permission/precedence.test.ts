import { describe, expect, it } from "vitest";
import { checkAgentRules } from "../../../src/permission/resolution.js";
import { findFilePermission, findPermission, matchesPattern, specificity } from "../../../src/permission/precedence.js";
import type { PermissionCheck } from "../../../src/permission/types.js";

function check(unresolved: string[]): PermissionCheck {
  return { sessionId: "session-1", toolName: "bash", category: "bash", raw: unresolved.join(" && "), unresolved, purpose: "test" };
}

describe("permission precedence", () => {
  it.each([
    ["src/file.ts", "src/file.ts", false, true],
    ["src/file.ts", "src/*.ts", false, true],
    ["src/.env", "src/*", false, true],
    ["src/file.ts", "*.ts", false, false],
    ["src/rm -rf", "rm *", true, false],
    ["rm -rf", "rm *", true, true],
    ["src/file.ts", "[", false, false],
  ])("matches %s against %s", (input, pattern, bash, expected) => {
    expect(matchesPattern(input, pattern, bash)).toBe(expected);
  });

  it("ranks literals above glob suffixes, then longer patterns", () => {
    expect(specificity("src/file.ts")[0]).toBe(Infinity);
    expect(specificity("**/file.ts")[0]).toBeGreaterThan(specificity("**/*.ts")[0]);
    expect(specificity("**/src/*.ts")).toEqual([3, "**/src/*.ts".length]);
  });

  it("uses specificity before scope and scope before same-rank allow", () => {
    expect(findPermission([{ "**/*.ts": false }, { "**/safe.ts": true }], "src/safe.ts")).toBe("allowed");
    expect(findPermission([{ "**/*.ts": true }, { "**/*.ts": false }], "src/file.ts")).toBe("allowed");
  });

  it("lets deny win for equal-rank rules in one scope independent of insertion order", () => {
    expect(findPermission([{ "src/*.ts": true, "s?c/*.ts": false }], "src/file.ts")).toBe("s?c/*.ts");
    expect(findPermission([{ "s?c/*.ts": false, "src/*.ts": true }], "src/file.ts")).toBe("s?c/*.ts");
  });

  it("returns ask when no rule matches", () => {
    expect(findPermission([], "src/file.ts")).toBe("ask");
    expect(findPermission([{ "**/*.md": true }], "src/file.ts")).toBe("ask");
  });

  it("returns the denying boolean rule for diagnostics", () => {
    expect(findPermission([{ "https://example.com": true }], "https://example.com")).toBe("allowed");
    expect(findPermission([{ "https://example.com": false }], "https://example.com")).toBe("https://example.com");
  });

  it.each([
    ["read", "read", "allowed"],
    ["read", "write", "**/*.ts"],
    ["write", "read", "allowed"],
    ["write", "write", "allowed"],
    ["deny", "read", "**/*.ts"],
    ["deny", "write", "**/*.ts"],
  ] as const)("resolves file access %s for %s", (access, operation, expected) => {
    expect(findFilePermission([{ "**/*.ts": access }], {
      absolute: "/project/src/file.ts", relative: "src/file.ts",
    }, operation)).toBe(expected);
  });

  it("requires agent allowlists to cover every unresolved input", () => {
    expect(checkAgentRules({ description: "test", bash: ["git *"] }, check(["git status", "rm -rf tmp"]))).toBe(false);
    expect(checkAgentRules({ description: "test", bash: ["git *"] }, check(["git status"]))).toBe(true);
  });
});
