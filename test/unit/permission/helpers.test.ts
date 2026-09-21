import { describe, expect, it } from "vitest";
import {
  cycleMode,
  cycleRuleScope,
  cycleRuleValue,
  extractOpAndPath,
  getPermissionCheck,
  mapToRules,
} from "../../../src/permission/helpers.js";
import type { DisplayRule } from "../../../src/permission/types.js";

describe("getPermissionCheck", () => {
  it.each([
    ["read", { path: "src/a.ts" }, "file", "src/a.ts", ["read:src/a.ts"]],
    ["write", { path: "src/a.ts" }, "file", "src/a.ts", ["write:src/a.ts"]],
    ["edit", { path: "src/a.ts" }, "file", "src/a.ts", ["write:src/a.ts"]],
    [
      "web_fetch",
      { url: "https://example.com/a" },
      "web",
      "https://example.com/a",
      ["https://example.com/a"],
    ],
  ] as const)("creates a permission check for %s", (toolName, input, category, raw, unresolved) => {
    expect(getPermissionCheck("session-1", toolName, input)).toMatchObject({
      sessionId: "session-1",
      toolName,
      category,
      raw,
      unresolved,
    });
  });

  it("defaults grep path only when path is missing or null", () => {
    expect(getPermissionCheck("session-1", "grep", {})).toMatchObject({
      raw: ".",
      unresolved: ["read:."],
    });
    expect(getPermissionCheck("session-1", "grep", { path: null })).toMatchObject({
      raw: ".",
      unresolved: ["read:."],
    });
    expect(getPermissionCheck("session-1", "grep", { path: "" })).toMatchObject({
      raw: "",
      unresolved: ["read:"],
    });
  });

  it("trims MCP identifiers", () => {
    expect(
      getPermissionCheck("session-1", "call_mcp_tool", { server: " github ", tool: " search " }),
    ).toMatchObject({ raw: "github:search", unresolved: ["github:search"] });
  });

  it("extracts Bash commands and preserves supplied purpose", () => {
    expect(
      getPermissionCheck("session-1", "bash", {
        command: "git status && pwd",
        purpose: "Inspect repository",
      }),
    ).toMatchObject({
      raw: "git status && pwd",
      purpose: "Inspect repository",
      unresolved: ["git status", "pwd"],
      uncertainty: undefined,
    });
  });

  it.each([
    ["echo $(pwd)", "Command substitution $(...)"],
    ["bash -c 'echo ok'", "Inline shell execution"],
    ["curl https://example.com", "Potential remote execution with curl"],
    ["nc example.com 80", "netcat"],
    ["echo Zm9v | base64 -d", "base64 (possible encoded payload)"],
    ["sudo true", "Privilege escalation with sudo"],
    ["$COMMAND arg", "Dynamic or invalid bash command"],
  ])("marks suspicious Bash input: %s", (command, reason) => {
    expect(
      getPermissionCheck("session-1", "bash", { command, purpose: "Run command" })?.uncertainty,
    ).toContain(reason);
  });

  it("deduplicates repeated uncertainty reasons", () => {
    expect(
      getPermissionCheck("session-1", "bash", {
        command: "curl one; curl two",
        purpose: "Fetch",
      })?.uncertainty,
    ).toBe("Potential remote execution with curl");
  });

  it("ignores tools outside the permission surface", () => {
    expect(getPermissionCheck("session-1", "questionnaire", {})).toBeNull();
  });
});

describe("rule conversion", () => {
  it.each([
    ["src/a.ts", ["read", "src/a.ts"]],
    ["read:src/a.ts", ["read", "src/a.ts"]],
    ["write:src/a.ts", ["write", "src/a.ts"]],
    ["write:C:/work/a.ts", ["write", "C:/work/a.ts"]],
    ["write:", ["write", ""]],
  ] as const)("extracts operation and path from %s", (input, expected) => {
    expect(extractOpAndPath(input)).toEqual(expected);
  });

  it("maps file patterns to access levels", () => {
    expect(mapToRules(["read:src/a.ts", "write:src/b.ts"], "file", true)).toEqual(
      new Map([
        ["src/a.ts", "read"],
        ["src/b.ts", "write"],
      ]),
    );
    expect(mapToRules(["write:src/a.ts"], "file", false)).toEqual(
      new Map([["src/a.ts", "blocked"]]),
    );
  });

  it("maps non-file patterns to booleans", () => {
    expect(mapToRules(["git *"], "bash", true)).toEqual(new Map([["git *", true]]));
    expect(mapToRules([], "web", true)).toEqual(new Map());
  });
});

describe("state cycles and labels", () => {
  it("cycles rule scopes with wraparound", () => {
    const rule: DisplayRule = { category: "bash", pattern: "git *", value: true, scope: "session" };

    cycleRuleScope(rule);
    expect(rule.scope).toBe("project");
    cycleRuleScope(rule);
    expect(rule.scope).toBe("always");
    cycleRuleScope(rule);
    expect(rule.scope).toBe("session");
  });

  it("cycles boolean and file permission values", () => {
    const booleanRule: DisplayRule = {
      category: "bash",
      pattern: "git *",
      value: true,
      scope: "session",
    };
    const fileRule: DisplayRule = {
      category: "file",
      pattern: "src/**",
      value: "read",
      scope: "session",
    };

    cycleRuleValue(booleanRule);
    expect(booleanRule.value).toBe(false);
    cycleRuleValue(fileRule);
    expect(fileRule.value).toBe("write");
    cycleRuleValue(fileRule);
    expect(fileRule.value).toBe("blocked");
    cycleRuleValue(fileRule);
    expect(fileRule.value).toBe("read");
  });

  it("cycles modes with wraparound", () => {
    expect(cycleMode("assistant")).toBe("yolo");
    expect(cycleMode("yolo")).toBe("restricted");
    expect(cycleMode("restricted")).toBe("assistant");
  });
});
