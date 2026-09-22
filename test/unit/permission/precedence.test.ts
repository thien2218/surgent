import { describe, expect, it } from "vitest";
import { checkAgentRules } from "../../../src/permission/resolution.js";
import { findScopedPermission, matchesPattern, specificity } from "../../../src/permission/precedence.js";
import type { PermissionCheck } from "../../../src/permission/types.js";

function check(category: PermissionCheck["category"], unresolved: string[]): PermissionCheck {
  return { sessionId: "session-1", toolName: "read", category, raw: unresolved[0] ?? "", unresolved, purpose: "test" };
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
    expect(findScopedPermission([{ "**/*.ts": false }, { "**/safe.ts": true }], "src/safe.ts")).toBe("allowed");
    expect(findScopedPermission([{ "**/*.ts": true }, { "**/*.ts": false }], "src/file.ts")).toBe("allowed");
  });

  it("lets deny win for equal-rank rules in one scope independent of insertion order", () => {
    expect(findScopedPermission([{ "**/*.ts": true, "{src,lib}/*.ts": false }], "src/file.ts")).toBe("deny");
    expect(findScopedPermission([{ "{src,lib}/*.ts": false, "**/*.ts": true }], "src/file.ts")).toBe("deny");
  });

  it("returns ask when no rule matches", () => {
    expect(findScopedPermission([], "src/file.ts")).toBe("ask");
    expect(findScopedPermission([{ "**/*.md": true }], "src/file.ts")).toBe("ask");
  });

  it("resolves boolean and file operation permissions", () => {
    expect(findScopedPermission([{ "https://example.com": true }], "https://example.com")).toBe("allowed");
    expect(findScopedPermission([{ "https://example.com": false }], "https://example.com")).toBe("deny");
    expect(findScopedPermission([{ "**/*.ts": "read" }], "src/file.ts", false, "read")).toBe("allowed");
    expect(findScopedPermission([{ "**/*.ts": "read" }], "src/file.ts", false, "write")).toBe("deny");
    expect(findScopedPermission([{ "**/*.ts": "write" }], "src/file.ts", false, "read")).toBe("allowed");
    expect(findScopedPermission([{ "**/*.ts": "deny" }], "src/file.ts", false, "read")).toBe("deny");
  });

  it("requires agent allowlists to cover every unresolved input", () => {
    expect(checkAgentRules({ description: "test", "files.read": ["src/**"] }, check("file", ["read:src/a.ts", "read:test/a.ts"]))).toBe(false);
    expect(checkAgentRules({ description: "test", "files.read": ["src/**"], "files.write": ["tmp/**"] }, check("file", ["read:src/a.ts", "write:tmp/a.ts"]))).toBe(true);
    expect(checkAgentRules({ description: "test", bash: ["git *"] }, check("bash", ["git status", "rm -rf tmp"]))).toBe(false);
    expect(checkAgentRules({ description: "test", bash: ["git *"] }, check("bash", ["git status"]))).toBe(true);
  });
});
