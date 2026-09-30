import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentFile,
  loadAgentProfiles,
  loadAgents,
  writeAgentMeta,
} from "../../../src/agent/storage.js";
import { getPiPath } from "../../../src/utils.js";
import { agentWorkspace } from "../../helpers/agent.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, readdir: vi.fn(filesystem.readdir) };
});

describe("agent discovery", () => {
  it("lets local general override global and shipped defaults", async () => {
    const workspace = await agentWorkspace();
    await writeFile(join(workspace.global, "general.md"), "---\ndescription: Global\n---\nGlobal prompt");
    await writeFile(join(workspace.local, "general.md"), "---\ndescription: Local\n---\nLocal prompt");

    const profiles = await loadAgentProfiles(workspace.cwd, "general");

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ scope: "local", agent: { name: "general", body: "Local prompt" } });
  });

  it("uses global general when no local override exists", async () => {
    const workspace = await agentWorkspace();
    await writeFile(join(workspace.global, "general.md"), "---\ndescription: Global\n---\nGlobal prompt");

    expect(await loadAgentProfiles(workspace.cwd, "general"))
      .toMatchObject([{ scope: "global", agent: { body: "Global prompt" } }]);
  });

  it("keeps an invalid local profile visible instead of exposing its global namesake", async () => {
    const workspace = await agentWorkspace();
    await writeFile(join(workspace.global, "probe.md"), "---\ndescription: Global\n---\nSafe prompt");
    await writeFile(join(workspace.local, "probe.md"), "Missing frontmatter");

    const profiles = await loadAgentProfiles(workspace.cwd, "probe");

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: "probe", scope: "local", error: expect.stringContaining("frontmatter") });
    expect(profiles[0]?.agent).toBeUndefined();
    await expect(loadAgents(workspace.cwd, "probe")).rejects.toThrow("frontmatter");
  });

  it.each([
    ["tools: read", "tools"],
    ["mcp_tools:", "mcp_tools"],
    ["skills: [read,]", "skills"],
    ["thinking_level: extreme", "Thinking level"],
    ["tools [read]", "Invalid metadata line"],
  ])("reports malformed metadata %s without loading unrestricted agent", async (metadata, reason) => {
    const workspace = await agentWorkspace();
    await writeFile(join(workspace.local, "probe.md"), `---\ndescription: Probe\n${metadata}\n---\nPrompt`);

    const profiles = await loadAgentProfiles(workspace.cwd, "probe");

    expect(profiles[0]?.error).toContain(reason);
    await expect(loadAgents(workspace.cwd, "probe")).rejects.toThrow(reason);
    expect((await loadAgents(workspace.cwd)).some((agent) => agent.name === "probe")).toBe(false);
  });

  it("preserves empty restrictions and mixed quoting for tool names", async () => {
    const workspace = await agentWorkspace();
    await writeFile(join(workspace.local, "probe.md"), "---\ndescription: Probe\ntools: [read, \"write\", 'bash']\nfiles.read: []\nbash: []\n---\nPrompt");

    const [agent] = await loadAgents(workspace.cwd, "probe");

    expect(agent.meta).toEqual({ description: "Probe", tools: ["read", "write", "bash"], "files.read": [], bash: [] });
  });

  it("does not let a directory named like a profile hide a real profile", async () => {
    const workspace = await agentWorkspace();
    await mkdir(join(workspace.local, "probe.md"));
    await writeFile(join(workspace.global, "probe.md"), "---\ndescription: Global\n---\nPrompt");

    expect(await loadAgentProfiles(workspace.cwd, "probe")).toMatchObject([{ scope: "global" }]);
  });

  it("propagates inaccessible local directory errors instead of falling back", async () => {
    const workspace = await agentWorkspace();
    const error = Object.assign(new Error("access denied"), { code: "EACCES" });
    vi.mocked(readdir).mockRejectedValueOnce(error);

    await expect(loadAgentProfiles(workspace.cwd)).rejects.toBe(error);
  });

  it("uses shipped profiles when local and global directories are absent", async () => {
    const workspace = await agentWorkspace();
    await rm(workspace.local, { recursive: true });
    await rm(workspace.global, { recursive: true });

    const profiles = await loadAgentProfiles(workspace.cwd);

    expect(profiles.map((profile) => profile.name).sort()).toEqual(["documenter", "general", "planner", "scout"]);
    expect(profiles.every((profile) => profile.scope === "built-in" && profile.agent?.body)).toBe(true);
  });

  it("rejects malformed built-in restriction overrides", async () => {
    const workspace = await agentWorkspace();
    await writeFile(getPiPath("settings"), JSON.stringify({ agent: { meta: { scout: { tools: "read" } } } }));

    await expect(loadAgents(workspace.cwd, "scout")).rejects.toThrow("tools must be an array");
  });
});
