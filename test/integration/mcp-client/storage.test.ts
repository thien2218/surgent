import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { saveEditedServer } from "../../../src/mcp-client/helpers.js";
import { loadMcpConfigs, readConfigFile, resolveServerConfig, updateServerConfig } from "../../../src/mcp-client/storage.js";
import type { ResolvedMcpServer } from "../../../src/mcp-client/types.js";
import { commandContext } from "../../helpers/commands.js";
import { makePermissionWorkspace } from "../../helpers/permission.js";

async function setup() {
  const workspace = await makePermissionWorkspace("surgent-mcp-storage-");
  onTestFinished(workspace.restore);
  vi.stubEnv("USERPROFILE", workspace.home);
  onTestFinished(() => { vi.unstubAllEnvs(); });
  return { ...workspace, ...commandContext(workspace.cwd) };
}

const local = { transport: "stdio", command: "fixture-command", enabled: false } as const;
const remote = { transport: "http", url: "http://localhost/mcp", enabled: true } as const;

it("treats missing files as empty without creating them", async () => {
  const { cwd, home } = await setup();

  expect(await loadMcpConfigs(cwd)).toEqual([]);
  expect(await resolveServerConfig(cwd, "missing")).toBeUndefined();
  await expect(readFile(join(cwd, ".pi/mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(home, ".pi/agent/mcp.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("round-trips both scopes, reports replacement, and preserves unrelated entries on deletion", async () => {
  const { cwd, home } = await setup();

  expect(await updateServerConfig("project", cwd, "local", { kind: "upsert", config: local }))
    .toEqual({ path: join(cwd, ".pi/mcp.json"), updated: false });
  await updateServerConfig("global", cwd, "remote", { kind: "upsert", config: remote });
  await updateServerConfig("project", cwd, "keep", { kind: "upsert", config: local });
  expect(await updateServerConfig("project", cwd, "local", { kind: "upsert", config: { ...local, enabled: true } }))
    .toMatchObject({ updated: true });

  expect(await loadMcpConfigs(cwd)).toEqual(expect.arrayContaining([
    { ...local, enabled: true, name: "local", scope: "project" },
    { ...remote, name: "remote", scope: "global" },
  ]));
  expect(await resolveServerConfig(cwd, "remote")).toEqual({ ...remote, name: "remote", scope: "global" });
  expect(JSON.parse(await readFile(join(home, ".pi/agent/mcp.json"), "utf8"))).toEqual({ remote });

  expect(await updateServerConfig("project", cwd, "local", { kind: "delete" })).toMatchObject({ updated: true });
  expect(await updateServerConfig("project", cwd, "absent", { kind: "delete" })).toMatchObject({ updated: false });
  expect(await readConfigFile("project", cwd)).toEqual({ keep: local });
  expect(await readConfigFile("global", cwd)).toEqual({ remote });
});

it("reports corrupt JSON instead of replacing it on save", async () => {
  const { cwd } = await setup();
  const path = join(cwd, ".pi/mcp.json");
  await writeFile(path, '{"fixture":');

  await expect(loadMcpConfigs(cwd)).rejects.toBeInstanceOf(SyntaxError);
  await expect(updateServerConfig("project", cwd, "new", { kind: "upsert", config: local })).rejects.toBeInstanceOf(SyntaxError);

  expect(await readFile(path, "utf8")).toBe('{"fixture":');
});

it("reports filesystem errors rather than treating unreadable config as empty", async () => {
  const { cwd } = await setup();
  await mkdir(join(cwd, ".pi/mcp.json"));

  await expect(readConfigFile("project", cwd)).rejects.toMatchObject({ code: "EISDIR" });
});

it.each(["rename", "move"])("persists an edited server before removing its previous location: %s", async (operation) => {
  const { cwd, ctx, ui } = await setup();
  await updateServerConfig("project", cwd, "original", { kind: "upsert", config: local });
  const previous: ResolvedMcpServer = { ...local, name: "original", scope: "project" };
  const updated: ResolvedMcpServer = { ...previous, name: "renamed", scope: operation === "move" ? "global" : "project", enabled: true };

  await saveEditedServer(ctx, previous, updated);

  expect(await resolveServerConfig(cwd, "original")).toBeUndefined();
  expect(await resolveServerConfig(cwd, "renamed")).toEqual(updated);
  expect(await readConfigFile(updated.scope, cwd)).toEqual({ renamed: { ...local, enabled: true } });
  expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Updated MCP server"), "info");
});

it.each(["project", "global"] as const)("rejects an edit collision in %s scope without changing either entry", async (scope) => {
  const { cwd, ctx, ui } = await setup();
  await updateServerConfig("project", cwd, "original", { kind: "upsert", config: local });
  await updateServerConfig(scope, cwd, "taken", { kind: "upsert", config: remote });
  const previous: ResolvedMcpServer = { ...local, name: "original", scope: "project" };

  await expect(saveEditedServer(ctx, previous, { ...previous, name: "taken", scope })).rejects.toThrow("already exists");

  expect(await resolveServerConfig(cwd, "original")).toEqual(previous);
  expect((await readConfigFile(scope, cwd)).taken).toEqual(remote);
  expect(ui.notify).not.toHaveBeenCalled();
});

it("keeps the original server when a move destination cannot be read", async () => {
  const { cwd, home, ctx, ui } = await setup();
  await updateServerConfig("project", cwd, "original", { kind: "upsert", config: local });
  await mkdir(join(home, ".pi/agent/mcp.json"));
  const previous: ResolvedMcpServer = { ...local, name: "original", scope: "project" };

  await expect(saveEditedServer(ctx, previous, { ...previous, scope: "global" })).rejects.toMatchObject({ code: "EISDIR" });

  expect(await readConfigFile("project", cwd)).toEqual({ original: local });
  expect(ui.notify).not.toHaveBeenCalled();
});
