import { describe, expect, it } from "vitest";
import { bashToPattern, extractBashCommands } from "../../../src/permission/bash.js";
import { getPermissionCheck } from "../../../src/permission/helpers.js";

describe("bash command parsing", () => {
  it.each(["", " \n\t", "# comment only"])("does not invent commands for %j", (source) => {
    expect(extractBashCommands(source)).toEqual([]);
  });

  it.each([
    ["'git' status", "git status *"],
    ['"git" status', "git status *"],
    ["g\\it status", "git status *"],
    ["g'it' status", "git status *"],
    ['"g\\it" status', "g\\it *"],
    ['"tool\\$name" arg', "tool$name *"],
    ["git $action", "git *"],
  ])("decodes quoted or escaped command names in %s", (source, pattern) => {
    expect(bashToPattern(source)).toBe(pattern);
  });

  it("keeps quoted argument boundaries instead of treating their content as commands", () => {
    expect(extractBashCommands("printf '%s' 'hello; rm file'"))
      .toEqual([{ text: "printf '%s' 'hello; rm file'", unresolved: false }]);
  });

  it("extracts commands inside substitutions as well as the outer command", () => {
    expect(extractBashCommands("echo $(whoami)"))
      .toEqual([
        { text: "echo $(whoami)", unresolved: false },
        { text: "whoami", unresolved: false },
      ]);
  });

  it("deduplicates repeated commands without losing distinct commands", () => {
    expect(extractBashCommands("pwd; git status; pwd"))
      .toEqual([{ text: "pwd", unresolved: false }, { text: "git status", unresolved: false }]);
  });

  it.each(["${runner} arg", "$(which git) status", "$'git' status"])(
    "marks dynamically computed or obfuscated executable %s uncertain",
    async (source) => {
      expect(extractBashCommands(source)[0]).toMatchObject({ unresolved: true });
      expect((await getPermissionCheck("/unused", "session-1", "bash", { command: source, purpose: "test" }))?.uncertainty)
        .toContain("Dynamic or invalid bash command");
    },
  );

  it.each(["if then", "echo \"unterminated", "echo $("])("retains all invalid source %s for permission review", (source) => {
    expect(extractBashCommands(source)).toEqual([{ text: source, unresolved: true }]);
    expect(bashToPattern(source)).toBe(source);
  });

  it.each(["", " \n", "# comment", "VALUE=test"])("handles source without a command when proposing a rule: %j", (source) => {
    expect(bashToPattern(source)).toBe(source.trim());
  });
});
