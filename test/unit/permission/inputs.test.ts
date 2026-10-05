import { describe, expect, it } from "vitest";
import { getPermissionCheck } from "../../../src/permission/helpers.js";
import { extractBashCommands } from "../../../src/permission/bash.js";

describe("permission inputs", () => {
  it("matches the exact native identity, including case and collision suffixes", async () => {
    const toolName = "mcp__Docs__search_ab12cd34";
    expect(await getPermissionCheck("/unused", "session-1", toolName, {}))
      .toMatchObject({ raw: toolName, category: "mcp", toolName });
  });

  it.each(["list_mcp_resources", "list_mcp_resource_templates"])(
    "leaves %s outside permission checks, including unscoped listing", async (toolName) => {
      for (const input of [{}, { server: "Docs-api" }]) {
        expect(await getPermissionCheck("/unused", "session-1", toolName, input)).toBeNull();
      }
    },
  );

  it.each(["read_mcp_resource"])(
    "scopes %s to an explicit server without rewriting it", async (toolName) => {
      expect(await getPermissionCheck("/unused", "session-1", toolName, { server: "Docs-api" }))
        .toMatchObject({ raw: `${toolName}:Docs-api`, category: "mcp" });
    },
  );

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
