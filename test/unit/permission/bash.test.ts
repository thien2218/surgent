import { describe, expect, it } from "vitest";
import { bashToPattern, extractBashCommands } from "../../../src/permission/bash.js";

describe("extractBashCommands", () => {
  it("returns no commands for empty input", () => {
    expect(extractBashCommands("   \n")).toEqual([]);
  });

  it("extracts every command from lists and pipelines", () => {
    expect(extractBashCommands("echo hello | grep h && pwd; git status")).toEqual([
      { text: "echo hello", unresolved: false },
      { text: "grep h", unresolved: false },
      { text: "pwd", unresolved: false },
      { text: "git status", unresolved: false },
    ]);
  });

  it("deduplicates commands while keeping first-occurrence order", () => {
    expect(extractBashCommands("pwd; echo ok; pwd")).toEqual([
      { text: "pwd", unresolved: false },
      { text: "echo ok", unresolved: false },
    ]);
  });

  it("keeps nested executable commands visible", () => {
    expect(extractBashCommands("echo $(pwd)")).toEqual([
      { text: "echo $(pwd)", unresolved: false },
      { text: "pwd", unresolved: false },
    ]);
  });

  it.each(["$COMMAND arg", "$'echo' arg"])(
    "marks dynamic or undecodable command names as unresolved: %s",
    (source) => {
      expect(extractBashCommands(source)).toEqual([{ text: source, unresolved: true }]);
    },
  );

  it("marks invalid shell syntax as one unresolved command", () => {
    expect(extractBashCommands("if then")).toEqual([{ text: "if then", unresolved: true }]);
  });

  it("preserves quoted command spelling and excludes assignments and redirects", () => {
    expect(extractBashCommands('NAME=value "echo" hello > output.txt')).toEqual([
      { text: '"echo" hello', unresolved: false },
    ]);
  });
});

describe("bashToPattern", () => {
  it.each([
    ["", ""],
    ["pwd", "pwd"],
    ["pnpm test", "pnpm *"],
    ["git status --short", "git status *"],
    ["git $SUBCOMMAND", "git *"],
    ['"git" status', "git status *"],
    ["echo ok; rm file", "echo *"],
    ["if then", "if then"],
  ])("converts %j to %j", (source, expected) => {
    expect(bashToPattern(source)).toBe(expected);
  });
});
