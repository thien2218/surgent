import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupCli } from "../helpers/cli.js";

describe("real CLI startup", () => {
  it("loads Surgent tools and commands and preserves configuration across Git workspace restarts", async () => {
    const fixture = await setupCli();
    const git = await fixture.run("git", ["init", "--quiet"]);
    expect(git.status, git.stderr).toBe(0);
    await writeFile(join(fixture.workspace, "notes.txt"), "Offline workspace\n");
    const toolsPath = join(fixture.root, "tools.json");
    const probePath = join(fixture.root, "probe.mjs");
    // Observe the real Pi tool registry; no replacement runtime or tool implementations.
    await writeFile(probePath, `
      import { writeFile } from "node:fs/promises";
      export default function(pi) {
        pi.on("session_start", async () => {
          await writeFile(${JSON.stringify(toolsPath)}, JSON.stringify(pi.getActiveTools()));
        });
      }
    `);

    const first = await fixture.rpc(["--no-session", "--extension", probePath]);
    const commands = await first.request("get_commands");
    expect(commands.commands).toEqual(expect.arrayContaining([
      "agents", "permissions", "mcp", "plan", "init", "web-login",
    ].map((name) => expect.objectContaining({ name, source: "extension" }))));
    await first.close();

    expect(JSON.parse(await readFile(toolsPath, "utf8"))).toEqual(expect.arrayContaining([
      "read", "write", "edit", "bash", "grep", "code_map", "inspect", "subagent", "questionnaire",
      "web_search", "web_fetch",
    ]));
    expect(await readdir(join(fixture.workspace, ".pi"))).toEqual(expect.arrayContaining(["agents"]));
    const settingsPath = join(fixture.home, ".pi", "agent", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.hideThinkingBlock = true;
    settings.agent.meta.scout.description = "User-owned scout description";
    await writeFile(settingsPath, JSON.stringify(settings));
    const permissionsPath = join(fixture.home, ".pi", "agent", "permissions.json");
    const permissions = JSON.stringify({ file: { "private/**": "deny" } });
    await writeFile(permissionsPath, permissions);

    const second = await fixture.rpc();
    await second.close();

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      hideThinkingBlock: true,
      agent: { meta: { scout: { description: "User-owned scout description" } } },
    });
    expect(await readFile(permissionsPath, "utf8")).toBe(permissions);
    const ignored = await fixture.run("git", ["check-ignore", ".pi"]);
    expect(ignored.status, ignored.stderr).toBe(0);
    expect(ignored.stdout.trim()).toBe(".pi");
  }, 120_000);

  it("initializes each requested non-Git cwd outside the package checkout", async () => {
    const fixture = await setupCli();
    const other = join(fixture.root, "other");
    await mkdir(other);

    for (const workspace of [fixture.workspace, other]) {
      const session = await fixture.rpc(["--no-session"], workspace);
      await session.close();

      expect(await readdir(workspace)).toContain(".pi");
      expect(await readdir(workspace)).not.toContain(".git");
    }
  }, 120_000);

  it("flushes checkpoints on EOF and reopens a named session without generation", async () => {
    const fixture = await setupCli();
    const git = await fixture.run("git", ["init", "--quiet"]);
    expect(git.status, git.stderr).toBe(0);
    await writeFile(join(fixture.workspace, "notes.txt"), "Checkpoint content\n");
    const sessionPath = join(fixture.root, "session.jsonl");
    // Pi persists an existing empty session without requiring an assistant turn.
    await writeFile(sessionPath, "");

    const first = await fixture.rpc(["--session", sessionPath]);
    await first.request("set_session_name", { name: "offline-reopen" });
    const saved = await first.request("get_state");
    await first.close();

    expect(saved.sessionId).toEqual(expect.any(String));
    const history = (await readFile(sessionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(history[0]).toMatchObject({ type: "session", id: saved.sessionId, cwd: fixture.workspace });
    const checkpointPath = join(fixture.home, ".pi", "agent", "checkpoints",
      createHash("sha256").update(fixture.workspace).digest("hex"), "entries.json");
    const checkpoints = JSON.parse(await readFile(checkpointPath, "utf8"));
    expect(checkpoints[String(saved.sessionId)]?.__base__).toMatch(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

    const reopened = await fixture.rpc(["--session", sessionPath]);
    expect(reopened.state).toMatchObject({ sessionId: saved.sessionId, sessionFile: sessionPath, sessionName: "offline-reopen" });
    expect(await reopened.request("get_messages")).toEqual({ messages: [] });
    await reopened.close();
  }, 120_000);
});
