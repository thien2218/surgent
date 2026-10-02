import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionWorkspace } from "../../helpers/permission.js";

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client", () => ({
  Client: class {
    connect = sdk.connect;
    listTools = sdk.listTools;
    callTool = sdk.callTool;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  sdk.connect.mockResolvedValue(undefined);
  sdk.listTools.mockResolvedValue({ tools: [] });
});

async function setup(config: Record<string, unknown> = {}) {
  const workspace = await makePermissionWorkspace("surgent-mcp-tools-");
  onTestFinished(workspace.restore);
  vi.stubEnv("USERPROFILE", workspace.home);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  await writeFile(join(workspace.cwd, ".pi", "mcp.json"), JSON.stringify(config));
  const recorded = recordExtension();
  mcpClient(recorded.api);
  const { ctx } = commandContext(workspace.cwd);
  onTestFinished(async () => { await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx); });
  return { recorded, ctx };
}

describe("MCP tool access", () => {
  it.each([undefined, false, null, "true", 1])("blocks discovery and calls when enabled is %s", async (enabled) => {
    const { recorded, ctx } = await setup({
      fixture: { transport: "stdio", command: "unused-fixture", enabled },
    });

    const listing = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"] }, undefined, undefined, ctx);
    await expect(recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "echo" }, undefined, undefined, ctx))
      .rejects.toThrow("disabled");

    expect(listing.content).toEqual([{ type: "text", text: "### fixture\nError: MCP server is disabled." }]);
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it("allows an explicitly enabled server", async () => {
    const { recorded, ctx } = await setup({
      fixture: { transport: "stdio", command: "unused-fixture", enabled: true },
    });

    const result = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"] }, undefined, undefined, ctx);

    expect(result.content).toEqual([{ type: "text", text: "### fixture\nNo tools available." }]);
    expect(sdk.listTools).toHaveBeenCalledOnce();
  });
});
