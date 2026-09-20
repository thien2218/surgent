import { describe, expect, it } from "vitest";
import { findScopedPermission, matchesPattern } from "../../../src/permission/precedence.js";

describe("matchesPattern", () => {
  it("matches literals exactly", () => {
    expect(matchesPattern("src/index.ts", "src/index.ts")).toBe(true);
    expect(matchesPattern("src/index.ts", "src/other.ts")).toBe(false);
  });

  it("matches glob patterns including dotfiles", () => {
    expect(matchesPattern("src/index.ts", "src/*.ts")).toBe(true);
    expect(matchesPattern(".env", "*")).toBe(true);
  });

  it("rejects malformed and unrelated patterns without throwing", () => {
    expect(matchesPattern("src/index.ts", "src/[abc")).toBe(false);
    expect(matchesPattern("src/index.ts", "docs/**")).toBe(false);
  });
});

describe("findScopedPermission", () => {
  it("asks when no rule matches", () => {
    expect(findScopedPermission([], "src/index.ts")).toBe("ask");
    expect(findScopedPermission([{}], "src/index.ts")).toBe("ask");
    expect(findScopedPermission([{ "docs/**": true }], "src/index.ts")).toBe("ask");
  });

  it("uses first scope containing a matching rule", () => {
    expect(
      findScopedPermission([{ "src/**": true }, { "src/index.ts": false }], "src/index.ts"),
    ).toBe("allowed");
    expect(
      findScopedPermission([{ "docs/**": true }, { "src/index.ts": false }], "src/index.ts"),
    ).toBe("blocked");
  });

  it("uses most specific rule within one scope", () => {
    expect(
      findScopedPermission(
        [{ "src/**": false, "src/*.ts": true, "src/index.ts": true }],
        "src/index.ts",
      ),
    ).toBe("allowed");
  });

  it("lets denial win when matching rules have equal specificity", () => {
    const rules = { "src/*.ts": true, "src/a.*s": false };
    const reversedRules = { "src/a.*s": false, "src/*.ts": true };

    expect(findScopedPermission([rules], "src/a.ts")).toBe("blocked");
    expect(findScopedPermission([reversedRules], "src/a.ts")).toBe("blocked");
  });

  it.each([
    ["read", "read", "allowed"],
    ["read", "write", "blocked"],
    ["write", "read", "allowed"],
    ["write", "write", "allowed"],
    ["blocked", "read", "blocked"],
    ["blocked", "write", "blocked"],
  ] as const)("resolves file access %s for %s operations", (access, operation, expected) => {
    expect(findScopedPermission([{ "src/**": access }], "src/index.ts", false, operation)).toBe(
      expected,
    );
  });

  it("uses Bash glob semantics when requested", () => {
    expect(findScopedPermission([{ "git *": true }], "git status", true)).toBe("allowed");
  });
});
