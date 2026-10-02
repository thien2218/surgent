import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { McpClientManager } from "../../../src/mcp-client/client.js";
import type { ResolvedMcpServer } from "../../../src/mcp-client/types.js";

const sdk = vi.hoisted(() => ({
  connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(),
  stdioClose: vi.fn(), httpClose: vi.fn(), terminate: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client", () => ({
  Client: class {
    connect = sdk.connect;
    listTools = sdk.listTools;
    callTool = sdk.callTool;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class { close = sdk.stdioClose; },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    close = sdk.httpClose;
    terminateSession = sdk.terminate;
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  sdk.connect.mockResolvedValue(undefined);
  sdk.listTools.mockResolvedValue({ tools: [] });
  sdk.callTool.mockResolvedValue({ content: [{ type: "text", text: "fixture" }] });
  sdk.stdioClose.mockResolvedValue(undefined);
  sdk.httpClose.mockResolvedValue(undefined);
  sdk.terminate.mockResolvedValue(undefined);
});

function setup() {
  const manager = new McpClientManager();
  onTestFinished(() => manager.disposeAll());
  return manager;
}

const config: ResolvedMcpServer = { name: "fixture", scope: "project", transport: "stdio", command: "fixture-command", enabled: true };

it("reuses the connection for unchanged config across discovery and calls", async () => {
  const manager = setup();

  await manager.listTools(config);
  await manager.listTools({ ...config });
  const result = await manager.callTool(config, { name: "echo", arguments: { value: "fixture" } });

  expect(sdk.connect).toHaveBeenCalledOnce();
  expect(sdk.callTool).toHaveBeenCalledWith({ name: "echo", arguments: { value: "fixture" } });
  expect(result).toEqual({ content: [{ type: "text", text: "fixture" }] });
});

it("closes the old transport and reconnects when server config changes", async () => {
  const manager = setup();

  await manager.listTools(config);
  await manager.listTools({ ...config, command: "changed-command" });

  expect(sdk.stdioClose).toHaveBeenCalledOnce();
  expect(sdk.connect).toHaveBeenCalledTimes(2);
});

it("does not cache a failed connection and permits a later retry", async () => {
  const manager = setup();
  sdk.connect.mockRejectedValueOnce(new Error("fixture handshake failed"));

  await expect(manager.listTools(config)).rejects.toThrow("fixture handshake failed");
  await expect(manager.listTools(config)).resolves.toEqual({ tools: [] });

  expect(sdk.connect).toHaveBeenCalledTimes(2);
});

it("disposes every transport even when another close fails and makes repeated shutdown harmless", async () => {
  const manager = setup();
  await manager.listTools(config);
  await manager.listTools({ name: "remote", scope: "project", transport: "http", url: "http://localhost/mcp", enabled: true });
  sdk.stdioClose.mockRejectedValueOnce(new Error("fixture close failed"));
  sdk.terminate.mockRejectedValueOnce(new Error("fixture termination failed"));

  await manager.disposeAll();
  await manager.disposeAll();

  expect(sdk.stdioClose).toHaveBeenCalledOnce();
  expect(sdk.httpClose).toHaveBeenCalledOnce();
  expect(sdk.terminate).toHaveBeenCalledOnce();
});
