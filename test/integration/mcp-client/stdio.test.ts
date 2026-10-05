import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

it("launches stdio with configured args, env and cwd and shuts down its child through the Pi lifecycle", async () => {
  const workspace = await createWorkspace({ prefix: "surgent-mcp-stdio-" });
  await writeFile(join(workspace.cwd, ".pi/mcp.json"), JSON.stringify({
    fixture: {
      transport: "stdio", enabled: true, command: process.execPath,
      args: [fileURLToPath(new URL("../../fixtures/mcp-server.mjs", import.meta.url)), "fixture-argument"],
      env: { MCP_FIXTURE: "fake-value" }, cwd: workspace.cwd,
    },
  }));
  const recorded = recordExtension();
  mcpClient(recorded.api);
  const { ctx } = commandContext(workspace.cwd);
  onTestFinished(async () => { await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx); });

  const result = await recorded.tool("call_mcp_tool").execute("call", {
    server: "fixture", tool: "environment", arguments: { input: "fixture-input" },
  }, undefined, undefined, ctx);

  expect(result.content[0]).toMatchObject({ type: "text" });
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected fixture text response");
  const output = JSON.parse(content.text);
  expect(output).toMatchObject({
    arguments: { input: "fixture-input" }, argv: ["fixture-argument"], cwd: workspace.cwd, fixture: "fake-value", pid: expect.any(Number),
  });

  await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

  expect(() => process.kill(output.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
});
