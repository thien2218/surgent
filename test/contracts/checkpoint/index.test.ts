import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionEvent } from "@earendil-works/pi-coding-agent";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import checkpoint from "../../../src/checkpoint/index.js";
import { BASE_CHECKPOINT_KEY, readCheckpointStore, writeCheckpointStore } from "../../../src/checkpoint/store.js";
import { checkpointWorkspace } from "../../helpers/cleanup.js";
import { assistantMessage } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup() {
  const workspace = await checkpointWorkspace();
  const exec = vi.fn<ExtensionAPI["exec"]>(workspace.exec);
  const extension = recordExtension({ exec });
  const session = SessionManager.inMemory(workspace.cwd);
  const ui = {
    select: vi.fn<ExtensionContext["ui"]["select"]>(),
    notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
  };
  const ctx = { cwd: workspace.cwd, hasUI: true, sessionManager: session, ui } as unknown as ExtensionContext;
  checkpoint(extension.api);
  // Supply fields used by each handler; Pi routing and event construction are not simulated.
  const emit = async <Name extends ExtensionEvent["type"]>(name: Name, fields: Partial<Extract<ExtensionEvent, { type: Name }>> = {}) =>
    (extension.event(name) as (
      event: Extract<ExtensionEvent, { type: Name }>, context: ExtensionContext,
    ) => unknown)({ type: name, ...fields } as Extract<ExtensionEvent, { type: Name }>, ctx);
  const saved = async () => {
    await emit("agent_end");
    return (await readCheckpointStore(workspace.storePath))[ctx.sessionManager.getSessionId()] ?? {};
  };
  return { ...workspace, exec, extension, session, ui, ctx, emit, saved };
}

async function history() {
  const fixture = await setup();
  await writeFile(join(fixture.cwd, "file"), "base");
  await fixture.emit("session_start", { reason: "startup" });
  const first = fixture.session.appendMessage(assistantMessage("first"));
  await fixture.emit("before_agent_start");
  await writeFile(join(fixture.cwd, "file"), "later");
  const second = fixture.session.appendMessage(assistantMessage("second"));
  await fixture.emit("turn_start");
  await fixture.emit("tool_result", { toolName: "write", isError: false });
  await fixture.emit("turn_end");
  return { ...fixture, first, second };
}

describe("checkpoint session lifecycle", () => {
  it("captures startup base once and reloads saved checkpoints without replacing it", async () => {
    const fixture = await setup();
    await writeFile(join(fixture.cwd, "file"), "base");
    await fixture.emit("session_start", { reason: "startup" });
    const saved = await fixture.saved();
    expect(Object.keys(saved)).toEqual([BASE_CHECKPOINT_KEY]);
    expect(fixture.git(fixture.directory, ["show", `${saved[BASE_CHECKPOINT_KEY]}:file`])).toBe("base");
    expect(fixture.refs()).toContain(saved[BASE_CHECKPOINT_KEY]);
    await writeFile(join(fixture.cwd, "file"), "changed outside agent");
    await fixture.emit("session_start", { reason: "reload" });
    expect(await fixture.saved()).toEqual(saved);
  });

  it("captures pre-agent changes at the leaf or base when no leaf exists", async () => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    await writeFile(join(fixture.cwd, "file"), "before first prompt");
    await fixture.emit("before_agent_start");
    const base = (await fixture.saved())[BASE_CHECKPOINT_KEY];
    expect(fixture.git(fixture.directory, ["show", `${base}:file`])).toBe("before first prompt");
    const leaf = fixture.session.appendMessage(assistantMessage("previous"));
    await writeFile(join(fixture.cwd, "file"), "external edit");
    await fixture.emit("before_agent_start");
    const saved = await fixture.saved();
    expect(saved[BASE_CHECKPOINT_KEY]).toBe(base);
    expect(fixture.git(fixture.directory, ["show", `${saved[leaf]}:file`])).toBe("external edit");
  });

  it("clears outgoing mappings and turn state when a different session starts", async () => {
    const fixture = await history();
    const old = await fixture.saved();
    const oldId = fixture.session.getSessionId();
    await fixture.emit("tool_result", { toolName: "edit", isError: false });
    const next = SessionManager.inMemory(fixture.cwd);
    const leaf = next.appendMessage(assistantMessage("next session"));
    fixture.ctx.sessionManager = next;
    await fixture.emit("session_start", { reason: "resume" });
    await fixture.emit("turn_end");
    const saved = await fixture.saved();
    expect(Object.keys(saved)).toEqual([BASE_CHECKPOINT_KEY]);
    expect(saved[leaf]).toBeUndefined();
    expect((await readCheckpointStore(fixture.storePath))[oldId]).toEqual(old);
  });

  it.each(["write-tree", "update-ref"])("does not persist a startup checkpoint when %s fails", async (failure) => {
    const fixture = await setup();
    fixture.exec.mockImplementation((command, args, options) => args.includes(failure)
      ? Promise.resolve({ code: 1, stdout: "", stderr: "injected failure", killed: false })
      : fixture.api.exec(command, args, options));
    await fixture.emit("session_start", { reason: "startup" });
    expect(await fixture.saved()).toEqual({});
  });

  it("keeps failed pre-agent and turn-end snapshots out of persisted mappings", async () => {
    const fixture = await history();
    const before = await fixture.saved();
    const leaf = fixture.session.appendMessage(assistantMessage("failed turn"));
    fixture.exec.mockImplementation((command, args, options) => args.includes("update-ref")
      ? Promise.resolve({ code: 1, stdout: "", stderr: "ref locked", killed: false })
      : fixture.api.exec(command, args, options));
    await writeFile(join(fixture.cwd, "file"), "not retained");
    await fixture.emit("before_agent_start");
    await fixture.emit("tool_result", { toolName: "edit", isError: false });
    await fixture.emit("turn_end");
    expect((await fixture.saved())[leaf]).toBeUndefined();
    expect(await fixture.saved()).toEqual(before);
    fixture.exec.mockImplementation(fixture.api.exec);
    await fixture.emit("turn_end");
    expect((await fixture.saved())[leaf]).toBeUndefined();
  });

  it("disables subsequent handlers outside Git and never prompts", async () => {
    const fixture = await setup();
    await rm(join(fixture.cwd, ".git"), { recursive: true });
    await fixture.emit("session_start", { reason: "startup" });
    await fixture.emit("before_agent_start");
    await fixture.emit("tool_result", { toolName: "write", isError: false });
    await fixture.emit("turn_end");
    await fixture.emit("session_before_fork", { entryId: "missing", position: "at" });
    await fixture.emit("agent_end");
    await fixture.emit("session_shutdown");
    expect(fixture.ui.select).not.toHaveBeenCalled();
    await expect(readFile(fixture.storePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves on shutdown and leaves retained snapshots usable after repeated GC", async () => {
    const fixture = await history();
    await fixture.emit("session_shutdown");
    const saved = await readCheckpointStore(fixture.storePath);
    const checkpoints = saved[fixture.session.getSessionId()];
    if (!checkpoints) throw new Error("Shutdown did not persist session checkpoints");
    const tree = checkpoints[fixture.second];
    expect(fixture.git(fixture.directory, ["show", `${tree}:file`])).toBe("later");
    expect(fixture.exec.mock.calls.some(([, args]) => args.includes("gc") && args.includes("--auto"))).toBe(true);
    await fixture.emit("session_shutdown");
    expect(await readCheckpointStore(fixture.storePath)).toEqual(saved);
  });

  it("propagates save failure rather than discarding an unreadable store", async () => {
    const fixture = await history();
    await writeFile(fixture.storePath, "broken JSON");
    await expect(fixture.emit("agent_end")).rejects.toThrow();
    await expect(fixture.emit("session_shutdown")).rejects.toThrow();
    expect(await readFile(fixture.storePath, "utf8")).toBe("broken JSON");
  });
});

describe("checkpoint turn tracking", () => {
  it.each(["write", "edit", "subagent"])("captures successful %s results at the turn leaf", async (toolName) => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    const leaf = fixture.session.appendMessage(assistantMessage("result"));
    await fixture.emit("turn_start");
    await writeFile(join(fixture.cwd, "file"), toolName);
    await fixture.emit("tool_result", { toolName, isError: false });
    await fixture.emit("tool_result", { toolName, isError: false });
    await fixture.emit("turn_end");
    const saved = await fixture.saved();
    expect(fixture.git(fixture.directory, ["show", `${saved[leaf]}:file`])).toBe(toolName);
    await writeFile(join(fixture.cwd, "file"), "not another turn");
    await fixture.emit("turn_end");
    expect(await fixture.saved()).toEqual(saved);
  });

  it.each([
    { toolName: "write", isError: true }, { toolName: "edit", isError: true },
    { toolName: "subagent", isError: true }, { toolName: "read", isError: false },
    { toolName: "bash", isError: false },
  ])("ignores $toolName with isError=$isError", async ({ toolName, isError }) => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    const before = await fixture.saved();
    fixture.session.appendMessage(assistantMessage("result"));
    await writeFile(join(fixture.cwd, "file"), "changed");
    await fixture.emit("tool_result", { toolName, isError });
    await fixture.emit("turn_end");
    expect(await fixture.saved()).toEqual(before);
  });

  it("clears pending changes on turn start and after a turn without a leaf", async () => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    const before = await fixture.saved();
    await fixture.emit("tool_result", { toolName: "write", isError: false });
    await fixture.emit("turn_end");
    fixture.session.appendMessage(assistantMessage("late leaf"));
    await fixture.emit("turn_end");
    expect(await fixture.saved()).toEqual(before);
    await fixture.emit("tool_result", { toolName: "write", isError: false });
    await fixture.emit("turn_start");
    await fixture.emit("turn_end");
    expect(await fixture.saved()).toEqual(before);
  });
});

describe("checkpoint restore hooks", () => {
  it.each(["session_before_tree", "session_before_fork"] as const)("restores accepted navigation through %s", async (event) => {
    const fixture = await history();
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    const result = event === "session_before_tree"
      ? await fixture.emit(event, { preparation: { targetId: fixture.first, oldLeafId: fixture.second } as Extract<ExtensionEvent, { type: "session_before_tree" }>["preparation"] })
      : await fixture.emit(event, { entryId: fixture.first, position: "at" });
    expect(result).toBeUndefined();
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("base");
    expect(fixture.ui.select).toHaveBeenCalledWith("Restore code state?", ["Yes, restore code to that point", "No, keep current code"]);
    expect(fixture.ui.notify).toHaveBeenCalledWith("Code restored to checkpoint", "info");
  });

  it.each(["No, keep current code", undefined])("leaves code unchanged when restore choice is %s", async (choice) => {
    const fixture = await history();
    fixture.ui.select.mockResolvedValue(choice);
    expect(await fixture.emit("session_before_fork", { entryId: fixture.first, position: "at" })).toBeUndefined();
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
    expect(fixture.ui.notify).not.toHaveBeenCalled();
  });

  it("never prompts without UI or when target resolves to the current tree", async () => {
    const fixture = await history();
    fixture.ctx.hasUI = false;
    await fixture.emit("session_before_fork", { entryId: fixture.first, position: "at" });
    fixture.ctx.hasUI = true;
    await fixture.emit("session_before_fork", { entryId: fixture.second, position: "at" });
    expect(fixture.ui.select).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
  });

  it.each([
    { stderr: " stderr reason \n", stdout: "stdout reason", reason: "stderr reason" },
    { stderr: " \n", stdout: " stdout reason \n", reason: "stdout reason" },
    { stderr: "", stdout: "", reason: "git error" },
  ])("cancels failed restore and reports $reason", async ({ stderr, stdout, reason }) => {
    const fixture = await history();
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    fixture.exec.mockImplementation((command, args, options) => args.includes("read-tree")
      ? Promise.resolve({ code: 1, stderr, stdout, killed: false })
      : fixture.api.exec(command, args, options));
    expect(await fixture.emit("session_before_fork", { entryId: fixture.first, position: "at" })).toEqual({ cancel: true });
    expect(fixture.ui.notify).toHaveBeenCalledWith(expect.stringContaining(reason), "error");
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
  });

  it("does not prompt when startup cannot create any checkpoint", async () => {
    const fixture = await setup();
    fixture.exec.mockImplementation((command, args, options) => args.includes("write-tree")
      ? Promise.resolve({ code: 1, stdout: "", stderr: "failed", killed: false })
      : fixture.api.exec(command, args, options));
    await fixture.emit("session_start", { reason: "startup" });
    await fixture.emit("session_before_fork", { entryId: "missing", position: "at" });
    expect(fixture.ui.select).not.toHaveBeenCalled();
  });

  it("loads only the resumed session's persisted mappings", async () => {
    const fixture = await history();
    const saved = await fixture.saved();
    await writeCheckpointStore(fixture.storePath, "unrelated", new Map([[fixture.first, "f".repeat(40)]]));
    await fixture.emit("session_start", { reason: "resume" });
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    expect(await fixture.emit("session_before_fork", { entryId: fixture.first, position: "at" })).toBeUndefined();
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("base");
    expect(await fixture.saved()).toEqual(saved);
  });
});
