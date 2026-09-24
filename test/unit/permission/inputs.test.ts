import { describe, expect, it } from "vitest";
import { getPermissionCheck } from "../../../src/permission/helpers.js";
import { extractBashCommands } from "../../../src/permission/bash.js";

describe("permission inputs", () => {
  it("trims MCP server and tool identifiers without changing their case", async () => {
    expect(await getPermissionCheck("/unused", "session-1", "call_mcp_tool", { server: " Docs ", tool: " search " }))
      .toMatchObject({ raw: "Docs:search", category: "mcp", toolName: "call_mcp_tool" });
  });

  it("checks every command across chains, pipes, and newlines", async () => {
    const command = "git status && pnpm test\nprintf hello | cat\npwd";

    expect(await getPermissionCheck("/unused", "session-1", "bash", { command, purpose: "test" }))
      .toMatchObject({
        unresolved: ["git status", "pnpm test", "printf hello", "cat", "pwd"],
        uncertainty: undefined,
      });
  });

  it.each(["$runner test", "echo '"])("keeps dynamic or invalid command %s unresolved", async (command) => {
    expect(extractBashCommands(command)).toEqual([{ text: command, unresolved: true }]);
    expect((await getPermissionCheck("/unused", "session-1", "bash", { command, purpose: "test" }))?.uncertainty)
      .toBe("Dynamic or invalid bash command");
  });

  it.each([
    ["echo $(id)", "Command substitution"],
    ["echo ${HOME}", "Variable/command expansion"],
    ["bash -c 'echo ok'", "Inline shell execution"],
    ["sudo cat secret.txt", "Privilege escalation"],
    ["curl https://example.com", "Potential remote execution"],
  ])("flags suspicious command %s", async (command, reason) => {
    expect((await getPermissionCheck("/unused", "session-1", "bash", { command, purpose: "test" }))?.uncertainty)
      .toContain(reason);
  });
});
