import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import mcpClient from "../../../src/mcp-client/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

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

async function setup(config: Record<string, unknown> = {
  fixture: { transport: "stdio", command: "unused-fixture", enabled: true },
}) {
  const workspace = await createWorkspace({ prefix: "surgent-mcp-tools-" });
  await writeFile(join(workspace.cwd, ".pi", "mcp.json"), JSON.stringify(config));
  const recorded = recordExtension();
  mcpClient(recorded.api);
  const { ctx } = commandContext(workspace.cwd);
  onTestFinished(async () => { await recorded.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx); });
  return { recorded, ctx };
}

describe("MCP discovery failures", () => {
  it.each([new Error("fixture unavailable"), "fixture unavailable"])("preserves healthy results and continues after a server failure: %s", async (error) => {
    const config = { transport: "stdio", command: "unused-fixture", enabled: true };
    const { recorded, ctx } = await setup({ healthy: config, broken: config, later: config });
    sdk.listTools
      .mockResolvedValueOnce({ tools: [{ name: "first", inputSchema: { type: "object" } }] })
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ tools: [{ name: "last", inputSchema: { type: "object" } }] });

    const result = await recorded.tool("list_mcp_tools").execute("list", {
      servers: ["healthy", "broken", "later"],
    }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("**first**") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("### broken\nError: fixture unavailable") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("**last**") });
  });
});

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

describe("MCP registration and discovery", () => {
  it("registers the command, tools, schemas, and shutdown without connecting", async () => {
    const { recorded } = await setup();

    expect(recorded.command("mcp").description).toContain("MCP");
    expect(recorded.tool("list_mcp_tools").parameters).toMatchObject({ required: ["servers"] });
    expect(recorded.tool("call_mcp_tool").parameters).toMatchObject({ required: ["server", "tool"] });
    expect(recorded.event("session_shutdown")).toBeTypeOf("function");
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("reports an unknown server without preventing discovery from other servers", async () => {
    const { recorded, ctx } = await setup();

    const result = await recorded.tool("list_mcp_tools").execute("list", { servers: ["missing", " fixture "] }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Unknown MCP server") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("No tools available") });
    expect(sdk.listTools).toHaveBeenCalledOnce();
  });

  it("matches tool names and descriptions case-insensitively and returns their schemas", async () => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [
      { name: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      { name: "lookup", description: "SEARCH records", inputSchema: { type: "object" } },
      { name: "delete", inputSchema: { type: "object" } },
    ] });

    const result = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"], searchRegex: "search" }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("**Search**") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("**lookup**: SEARCH records") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"query"') });
    expect(result.content[0]).toMatchObject({ text: expect.not.stringContaining("**delete**") });
    expect(result.details).toEqual({ servers: ["fixture"], filter: "search" });
  });

  it("distinguishes a filter with no matches from an empty server", async () => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });

    const result = await recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"], searchRegex: "absent" }, undefined, undefined, ctx);

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("No tools match the filter") });
  });

  it("rejects invalid regex before contacting any server", async () => {
    const { recorded, ctx } = await setup();

    await expect(recorded.tool("list_mcp_tools").execute("list", { servers: ["fixture"], searchRegex: "[" }, undefined, undefined, ctx))
      .rejects.toBeInstanceOf(SyntaxError);

    expect(sdk.connect).not.toHaveBeenCalled();
  });
});

describe("MCP calls", () => {
  it("rejects unknown servers before connecting", async () => {
    const { recorded, ctx } = await setup();

    await expect(recorded.tool("call_mcp_tool").execute("call", { server: "missing", tool: "echo" }, undefined, undefined, ctx))
      .rejects.toThrow("Unknown MCP server");
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("rejects unavailable tools and lists available names without executing remotely", async () => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [
      { name: "zebra", inputSchema: { type: "object" } },
      { name: "alpha", inputSchema: { type: "object" } },
    ] });

    await expect(recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "missing" }, undefined, undefined, ctx))
      .rejects.toThrow("Available tools: alpha, zebra");
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it.each([undefined, { nested: { value: [1, true, null] } }])("trims names and forwards arguments or an empty object: %j", async (args) => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    sdk.callTool.mockResolvedValue({ content: [{ type: "text", text: "done" }] });

    const result = await recorded.tool("call_mcp_tool").execute("call", { server: " fixture ", tool: " echo ", arguments: args }, undefined, undefined, ctx);

    expect(sdk.callTool).toHaveBeenCalledWith({ name: "echo", arguments: args ?? {} });
    expect(result.details).toEqual({ server: "fixture", transport: "stdio", remoteTool: "echo" });
  });

  it("propagates remote execution failures instead of fabricating success", async () => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    sdk.callTool.mockRejectedValue(new Error("fixture disconnected"));

    await expect(recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "echo" }, undefined, undefined, ctx))
      .rejects.toThrow("fixture disconnected");
  });
});

describe("MCP cancellation checks", () => {
  it.each(["list_mcp_tools", "call_mcp_tool"])("rejects pre-cancelled %s without connecting", async (name) => {
    const { recorded, ctx } = await setup();

    await expect(recorded.tool(name).execute("cancelled", { servers: ["fixture"], server: "fixture", tool: "echo" }, AbortSignal.abort(), undefined, ctx))
      .rejects.toThrow("cancelled");

    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("does not execute a remote tool when cancelled during discovery", async () => {
    const { recorded, ctx } = await setup();
    const controller = new AbortController();
    sdk.listTools.mockImplementation(async () => {
      controller.abort();
      return { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
    });

    await expect(recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "echo" }, controller.signal, undefined, ctx))
      .rejects.toThrow("cancelled");

    expect(sdk.callTool).not.toHaveBeenCalled();
  });
});

describe("MCP result content", () => {
  it.each([
    { name: "text blocks", result: { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }, text: "first\n\nsecond" },
    { name: "structured content", result: { content: [], structuredContent: { count: 2 } }, text: '{\n  "count": 2\n}' },
    { name: "image", result: { content: [{ type: "image", mimeType: "image/png", data: "fake" }] }, text: "[image content: image/png]" },
    { name: "audio", result: { content: [{ type: "audio", mimeType: "audio/wav", data: "fake" }] }, text: "[audio content: audio/wav]" },
    { name: "text resource", result: { content: [{ type: "resource", resource: { uri: "fixture://text", text: "body" } }] }, text: "Resource fixture://text\nbody" },
    { name: "binary resource", result: { content: [{ type: "resource", resource: { uri: "fixture://binary", blob: "fake" } }] }, text: "[resource content: fixture://binary]" },
    { name: "resource link", result: { content: [{ type: "resource_link", uri: "fixture://link" }] }, text: "[resource link: fixture://link]" },
    { name: "legacy tool result", result: { toolResult: { count: 2 } }, text: '{\n  "count": 2\n}' },
    { name: "empty success", result: { content: [] }, text: "MCP tool returned no content." },
    { name: "empty error", result: { content: [], isError: true }, text: "MCP tool returned an error with no content." },
    { name: "remote error", result: { content: [{ type: "text", text: "denied" }], isError: true }, text: "Remote MCP tool reported an error.\n\ndenied" },
  ])("formats $name for Pi while retaining remote error state", async ({ result, text }) => {
    const { recorded, ctx } = await setup();
    sdk.listTools.mockResolvedValue({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
    sdk.callTool.mockResolvedValue(result);

    const response = await recorded.tool("call_mcp_tool").execute("call", { server: "fixture", tool: "echo" }, undefined, undefined, ctx);

    expect(response.content).toEqual([{ type: "text", text }]);
    expect(response).toMatchObject({ isError: "isError" in result && result.isError === true });
  });
});
