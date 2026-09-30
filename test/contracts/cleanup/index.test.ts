import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import cleanup from "../../../src/cleanup/index.js";
import { getPiPath } from "../../../src/utils.js";
import { checkpointWorkspace, cleanupWorkspace } from "../../helpers/cleanup.js";
import { assistantMessage, planMetadata, storePlans } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionContext } from "../../helpers/permission.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, writeFile: vi.fn(filesystem.writeFile) };
});

afterEach(() => {
  vi.mocked(writeFile).mockReset();
  vi.restoreAllMocks();
});

async function observeWrite(path: string) {
  const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let complete!: () => void;
  const done = new Promise<void>((resolve) => { complete = resolve; });
  vi.mocked(writeFile).mockImplementation(async (...args) => {
    await filesystem.writeFile(...args);
    if (args[0] === path) complete();
  });
  return { done };
}

describe("cleanup lifecycle", () => {
  it("retains plans owned by the current unsaved parent on reload", async () => {
    const workspace = await cleanupWorkspace();
    const parent = SessionManager.create(workspace.cwd);
    const child = SessionManager.create(workspace.cwd, getPiPath("subsessionsDir", workspace.cwd));
    child.appendMessage(assistantMessage("Saved plan"));
    const metadata = planMetadata("Saved plan", parent.getSessionId());
    await storePlans(workspace.cwd, {
      [child.getSessionId()]: metadata,
      orphan: planMetadata("Orphan", "missing-parent"),
    });
    expect(await SessionManager.list(workspace.cwd)).toEqual([]);
    const context = makePermissionContext(workspace.cwd);
    vi.spyOn(context.sessionManager, "getSessionId").mockReturnValue(parent.getSessionId());
    const extension = recordExtension({
      exec: async () => ({ stdout: "", stderr: "not a repository", code: 128, killed: false }),
    });
    cleanup(extension.api);
    const storePath = getPiPath("subsessions", workspace.cwd);
    const persisted = await observeWrite(storePath);

    await extension.event("session_start")({ type: "session_start", reason: "reload" }, context);
    await persisted.done;

    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({ [child.getSessionId()]: metadata });
    expect(await readFile(child.getSessionFile()!, "utf8")).toContain("Saved plan");
  });

  it("retains discovered root and child checkpoints when starting another session", async () => {
    const workspace = await checkpointWorkspace();
    const root = SessionManager.create(workspace.cwd);
    root.appendMessage(assistantMessage("Root response"));
    const child = SessionManager.create(workspace.cwd, getPiPath("subsessionsDir", workspace.cwd));
    child.appendMessage(assistantMessage("Child response"));
    const rootTree = workspace.tree("root");
    const childTree = workspace.tree("child");
    const staleTree = workspace.tree("stale");
    await writeFile(workspace.storePath, JSON.stringify({
      [root.getSessionId()]: { entry: rootTree },
      [child.getSessionId()]: { entry: childTree },
      "01900000-0000-7000-8000-000000000001": { entry: staleTree },
    }));
    const metadata = planMetadata("Child plan", root.getSessionId());
    await storePlans(workspace.cwd, {
      [child.getSessionId()]: metadata,
      orphan: planMetadata("Orphan", "missing-parent"),
    });
    const persisted = await observeWrite(getPiPath("subsessions", workspace.cwd));
    let complete!: () => void;
    const deleted = new Promise<void>((resolve) => { complete = resolve; });
    const extension = recordExtension({
      exec: async (...args) => {
        const result = await workspace.exec(...args);
        if (args[1].includes("update-ref")) complete();
        return result;
      },
    });
    cleanup(extension.api);

    await extension.event("session_start")(
      { type: "session_start", reason: "new" }, makePermissionContext(workspace.cwd),
    );
    await Promise.all([deleted, persisted.done]);

    expect(workspace.refs()).toEqual([rootTree, childTree].sort());
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({
      [root.getSessionId()]: { entry: rootTree },
      [child.getSessionId()]: { entry: childTree },
    });
    expect(JSON.parse(await readFile(getPiPath("subsessions", workspace.cwd), "utf8")))
      .toEqual({ [child.getSessionId()]: metadata });
  });

  it("continues subsession cleanup when checkpoint discovery rejects", async () => {
    const workspace = await cleanupWorkspace();
    await storePlans(workspace.cwd, { orphan: planMetadata() });
    const storePath = getPiPath("subsessions", workspace.cwd);
    const persisted = await observeWrite(storePath);
    const extension = recordExtension({ exec: async () => { throw new Error("Git unavailable"); } });
    cleanup(extension.api);

    await extension.event("session_start")(
      { type: "session_start", reason: "startup" }, makePermissionContext(workspace.cwd),
    );
    await persisted.done;

    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({});
  });

  it("continues checkpoint cleanup when subsession metadata is malformed", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("stale");
    await writeFile(workspace.storePath, JSON.stringify({
      "01900000-0000-7000-8000-000000000001": { entry: tree },
    }));
    const storePath = getPiPath("subsessions", workspace.cwd);
    await writeFile(storePath, "{broken");
    let complete!: () => void;
    const deleted = new Promise<void>((resolve) => { complete = resolve; });
    const extension = recordExtension({
      exec: async (...args) => {
        const result = await workspace.exec(...args);
        if (args[1].includes("update-ref")) complete();
        return result;
      },
    });
    cleanup(extension.api);

    await extension.event("session_start")(
      { type: "session_start", reason: "startup" }, makePermissionContext(workspace.cwd),
    );
    await deleted;

    expect(workspace.refs()).toEqual([]);
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual({});
    expect(await readFile(storePath, "utf8")).toBe("{broken");
  });

  it("returns from session startup without waiting for background Git work", async () => {
    const workspace = await cleanupWorkspace();
    await storePlans(workspace.cwd, { orphan: planMetadata() });
    const persisted = await observeWrite(getPiPath("subsessions", workspace.cwd));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    onTestFinished(release);
    const extension = recordExtension({
      exec: async () => {
        await blocked;
        return { stdout: "", stderr: "not a repository", code: 128, killed: false };
      },
    });
    cleanup(extension.api);
    let returned = false;
    const started = Promise.resolve(extension.event("session_start")(
      { type: "session_start", reason: "startup" }, makePermissionContext(workspace.cwd),
    )).then(() => { returned = true; });

    try {
      await persisted.done;
      expect(returned).toBe(true);
    } finally {
      release();
      await started;
    }
  });

  it("does not start destructive cleanup when session discovery rejects", async () => {
    const workspace = await checkpointWorkspace();
    const tree = workspace.tree("protected");
    const entries = { "01900000-0000-7000-8000-000000000001": { entry: tree } };
    await writeFile(workspace.storePath, JSON.stringify(entries));
    await storePlans(workspace.cwd, { orphan: planMetadata() });
    vi.spyOn(SessionManager, "list").mockRejectedValue(new Error("Discovery failed"));
    const exec = vi.fn(workspace.exec);
    const extension = recordExtension({ exec });
    cleanup(extension.api);

    await expect(extension.event("session_start")(
      { type: "session_start", reason: "startup" }, makePermissionContext(workspace.cwd),
    )).rejects.toThrow("Discovery failed");

    expect(exec).not.toHaveBeenCalled();
    expect(workspace.refs()).toEqual([tree]);
    expect(JSON.parse(await readFile(workspace.storePath, "utf8"))).toEqual(entries);
    expect(JSON.parse(await readFile(getPiPath("subsessions", workspace.cwd), "utf8")))
      .toEqual({ orphan: planMetadata() });
  });
});
