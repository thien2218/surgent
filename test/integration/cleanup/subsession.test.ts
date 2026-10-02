import { SessionManager } from "@earendil-works/pi-coding-agent";
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSubsessions } from "../../../src/cleanup/subsession.js";
import { getPiPath } from "../../../src/utils.js";
import { assistantMessage, planMetadata, storePlans } from "../../helpers/commands.js";
import { cleanupWorkspace } from "../../helpers/cleanup.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, writeFile: vi.fn(filesystem.writeFile) };
});

afterEach(() => {
  vi.mocked(writeFile).mockReset();
  vi.restoreAllMocks();
});

async function setup() {
  const workspace = await cleanupWorkspace();
  const directory = getPiPath("subsessionsDir", workspace.cwd);
  const storePath = getPiPath("subsessions", workspace.cwd);
  const transcript = () => {
    const session = SessionManager.create(workspace.cwd, directory);
    session.appendMessage(assistantMessage("Saved plan"));
    return { id: session.getSessionId(), path: session.getSessionFile()! };
  };
  return { ...workspace, directory, storePath, transcript };
}

describe("subsession cleanup", () => {
  it("removes orphan metadata and transcripts while preserving live and unrelated files", async () => {
    const workspace = await setup();
    const live = workspace.transcript();
    const stale = workspace.transcript();
    const unrelated = workspace.transcript();
    const otherDirectory = join(workspace.root, "other-workspace");
    await mkdir(otherDirectory);
    const otherFile = join(otherDirectory, "plan.jsonl");
    await copyFile(stale.path, otherFile);
    const liveMetadata = planMetadata("Live plan", "live-parent");
    await storePlans(workspace.cwd, {
      [live.id]: liveMetadata,
      [stale.id]: planMetadata("Stale plan", "missing-parent"),
    });
    const liveContent = await readFile(live.path, "utf8");
    const unrelatedContent = await readFile(unrelated.path, "utf8");
    const otherContent = await readFile(otherFile, "utf8");

    await cleanupSubsessions(workspace.cwd, new Set(["live-parent"]));

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({ [live.id]: liveMetadata });
    await expect(readFile(stale.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(live.path, "utf8")).toBe(liveContent);
    expect(await readFile(unrelated.path, "utf8")).toBe(unrelatedContent);
    expect(await readFile(otherFile, "utf8")).toBe(otherContent);
    await cleanupSubsessions(workspace.cwd, new Set(["live-parent"]));
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({ [live.id]: liveMetadata });
  });

  it("removes every transcript with an orphan's session ID", async () => {
    const workspace = await setup();
    const stale = workspace.transcript();
    const duplicate = join(workspace.directory, "duplicate.jsonl");
    await copyFile(stale.path, duplicate);
    await storePlans(workspace.cwd, { [stale.id]: planMetadata() });

    await cleanupSubsessions(workspace.cwd, new Set());

    await expect(readFile(stale.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(duplicate)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("removes orphan metadata even when its transcript is already missing", async () => {
    const workspace = await setup();
    await storePlans(workspace.cwd, { "missing-session": planMetadata() });

    await cleanupSubsessions(workspace.cwd, new Set());

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("does not rewrite a store whose parents are all retained", async () => {
    const workspace = await setup();
    const live = workspace.transcript();
    const original = JSON.stringify({ [live.id]: planMetadata("Live", "live-parent") });
    await writeFile(workspace.storePath, original);

    await cleanupSubsessions(workspace.cwd, new Set(["live-parent"]));

    expect(await readFile(workspace.storePath, "utf8")).toBe(original);
    expect(await readFile(live.path, "utf8")).toContain("Saved plan");
  });

  it("does not create a missing metadata store or delete untracked transcripts", async () => {
    const workspace = await setup();
    const unrelated = workspace.transcript();

    await cleanupSubsessions(workspace.cwd, new Set());

    await expect(readFile(workspace.storePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(unrelated.path, "utf8")).toContain("Saved plan");
  });

  it.each(["{broken", "[]", "null", '{"session":null}'])("preserves malformed metadata %s and transcripts", async (content) => {
    const workspace = await setup();
    const session = workspace.transcript();
    await writeFile(workspace.storePath, content);

    await expect(cleanupSubsessions(workspace.cwd, new Set())).rejects.toThrow();

    expect(await readFile(workspace.storePath, "utf8")).toBe(content);
    expect(await readFile(session.path, "utf8")).toContain("Saved plan");
  });

  it("tolerates a transcript disappearing between discovery and deletion", async () => {
    const workspace = await setup();
    const stale = workspace.transcript();
    await storePlans(workspace.cwd, { [stale.id]: planMetadata() });
    const list = SessionManager.list;
    vi.spyOn(SessionManager, "list").mockImplementationOnce(async (...args) => {
      const sessions = await list(...args);
      await unlink(stale.path);
      return sessions;
    });

    await cleanupSubsessions(workspace.cwd, new Set());

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
    await expect(readFile(stale.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves metadata after a partial deletion failure so later cleanup can finish", async () => {
    const workspace = await setup();
    const first = workspace.transcript();
    const second = workspace.transcript();
    const original = { [first.id]: planMetadata(), [second.id]: planMetadata() };
    await storePlans(workspace.cwd, original);
    const list = SessionManager.list;
    vi.spyOn(SessionManager, "list").mockImplementationOnce(async (...args) => {
      const sessions = await list(...args);
      await unlink(second.path);
      await mkdir(second.path);
      // Fix discovery order to prove one deletion succeeds before the next fails.
      return [sessions.find((session) => session.id === first.id)!, sessions.find((session) => session.id === second.id)!];
    });

    await expect(cleanupSubsessions(workspace.cwd, new Set())).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM)$/),
    });

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual(original);
    await expect(readFile(first.path)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(second.path, { recursive: true });
    await cleanupSubsessions(workspace.cwd, new Set());
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("can finish cleanup after metadata persistence fails following transcript deletion", async () => {
    const workspace = await setup();
    const stale = workspace.transcript();
    const original = { [stale.id]: planMetadata() };
    await storePlans(workspace.cwd, original);
    vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error("Disk full"), { code: "ENOSPC" }));

    await expect(cleanupSubsessions(workspace.cwd, new Set())).rejects.toMatchObject({ code: "ENOSPC" });

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual(original);
    await expect(readFile(stale.path)).rejects.toMatchObject({ code: "ENOENT" });
    await cleanupSubsessions(workspace.cwd, new Set());
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
  });

  it("preserves metadata and transcripts when discovery fails", async () => {
    const workspace = await setup();
    const stale = workspace.transcript();
    const original = { [stale.id]: planMetadata() };
    await storePlans(workspace.cwd, original);
    vi.spyOn(SessionManager, "list").mockRejectedValueOnce(new Error("Discovery failed"));

    await expect(cleanupSubsessions(workspace.cwd, new Set())).rejects.toThrow("Discovery failed");

    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual(original);
    expect(await readFile(stale.path, "utf8")).toContain("Saved plan");
  });
});
