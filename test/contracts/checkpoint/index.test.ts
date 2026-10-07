import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionEvent } from "@earendil-works/pi-coding-agent";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import checkpoint from "../../../src/checkpoint/index.js";
import { BASE_CHECKPOINT_KEY, readCheckpointStore, writeCheckpointStore } from "../../../src/checkpoint/store.js";
import { checkpointWorkspace } from "../../helpers/cleanup.js";
import { assistantMessage } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

async function setup(persist = false) {
  const workspace = await checkpointWorkspace();
  const exec = vi.fn<ExtensionAPI["exec"]>(workspace.exec);
  let extension = recordExtension({ exec });
  const session = persist
    ? SessionManager.create(workspace.cwd, join(workspace.home, "sessions"))
    : SessionManager.inMemory(workspace.cwd);
  const ui = {
    select: vi.fn<ExtensionContext["ui"]["select"]>(),
    notify: vi.fn<ExtensionContext["ui"]["notify"]>(),
  };
  const ctx = { cwd: workspace.cwd, hasUI: true, sessionManager: session, ui } as unknown as ExtensionContext;
  checkpoint(extension.api);
  const replaceExtension = () => {
    extension = recordExtension({ exec });
    checkpoint(extension.api);
  };
  // Supply fields used by each handler; Pi routing and event construction are not simulated.
  const emit = async <Name extends ExtensionEvent["type"]>(name: Name, fields: Partial<Extract<ExtensionEvent, { type: Name }>> = {}) =>
    (extension.event(name) as (
      event: Extract<ExtensionEvent, { type: Name }>, context: ExtensionContext,
    ) => unknown)({ type: name, ...fields } as Extract<ExtensionEvent, { type: Name }>, ctx);
  const saved = async () => {
    await emit("agent_end");
    return (await readCheckpointStore(workspace.storePath))[ctx.sessionManager.getSessionId()] ?? {};
  };
  return { ...workspace, exec, session, ui, ctx, emit, saved, replaceExtension };
}

async function history(persist = false) {
  const fixture = await setup(persist);
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
    await fixture.emit("session_shutdown", { reason: "reload" });
    fixture.replaceExtension();
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

  it("starts replacement sessions without outgoing mappings or pending turn state", async () => {
    const fixture = await history();
    const old = await fixture.saved();
    const oldId = fixture.session.getSessionId();
    await fixture.emit("tool_result", { toolName: "edit", isError: false });
    const next = SessionManager.inMemory(fixture.cwd);
    const leaf = next.appendMessage(assistantMessage("next session"));
    await fixture.emit("session_shutdown", { reason: "resume" });
    fixture.ctx.sessionManager = next;
    fixture.replaceExtension();
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

  it("keeps replacement handlers inactive when startup fails after shutdown", async () => {
    const fixture = await history();
    const before = await fixture.saved();
    await fixture.emit("session_shutdown", { reason: "resume" });
    fixture.replaceExtension();
    fixture.exec.mockRejectedValueOnce(Object.assign(new Error("filesystem unavailable"), { code: "EIO" }));
    await expect(fixture.emit("session_start", { reason: "resume" })).rejects.toMatchObject({ code: "EIO" });
    fixture.exec.mockClear();
    await fixture.emit("before_agent_start");
    await fixture.emit("tool_result", { toolName: "edit", isError: false });
    await fixture.emit("turn_end");
    await fixture.emit("agent_end");
    await fixture.emit("session_shutdown");
    expect(fixture.exec).not.toHaveBeenCalled();
    expect((await readCheckpointStore(fixture.storePath))[fixture.session.getSessionId()]).toEqual(before);
  });

  it("saves on shutdown and skips Git work after repository disposal", async () => {
    const fixture = await history();
    await fixture.emit("session_shutdown");
    const saved = await readCheckpointStore(fixture.storePath);
    const checkpoints = saved[fixture.session.getSessionId()];
    if (!checkpoints) throw new Error("Shutdown did not persist session checkpoints");
    const tree = checkpoints[fixture.second];
    expect(fixture.git(fixture.directory, ["show", `${tree}:file`])).toBe("later");
    expect(fixture.exec.mock.calls.some(([, args]) => args.includes("gc") && args.includes("--auto"))).toBe(true);
    fixture.exec.mockClear();
    await fixture.emit("session_shutdown");
    expect(fixture.exec).not.toHaveBeenCalled();
    expect(await readCheckpointStore(fixture.storePath)).toEqual(saved);
  });

  it("propagates save failure rather than discarding an unreadable store", async () => {
    const fixture = await history();
    await writeFile(fixture.storePath, "broken JSON");
    await expect(fixture.emit("agent_end")).rejects.toThrow();
    await expect(fixture.emit("session_shutdown")).rejects.toThrow();
    fixture.exec.mockClear();
    await fixture.emit("before_agent_start");
    await fixture.emit("agent_end");
    await expect(fixture.emit("session_shutdown")).resolves.toBeUndefined();
    expect(fixture.exec).not.toHaveBeenCalled();
    expect(await readFile(fixture.storePath, "utf8")).toBe("broken JSON");
  });

  it("disposes the repository even when shutdown garbage collection throws", async () => {
    const fixture = await history();
    const before = await fixture.saved();
    fixture.exec.mockImplementation((command, args, options) => args.includes("gc")
      ? Promise.reject(Object.assign(new Error("garbage collection failed"), { code: "EIO" }))
      : fixture.api.exec(command, args, options));

    await expect(fixture.emit("session_shutdown")).rejects.toMatchObject({ code: "EIO" });

    fixture.exec.mockClear();
    await fixture.emit("before_agent_start");
    await fixture.emit("agent_end");
    await expect(fixture.emit("session_shutdown")).resolves.toBeUndefined();
    expect(fixture.exec).not.toHaveBeenCalled();
    expect((await readCheckpointStore(fixture.storePath))[fixture.session.getSessionId()]).toEqual(before);
  });
});

describe("checkpoint fork inheritance", () => {
  it.each(["at", "before"] as const)("inherits only the retained branch when forking %s a user entry", async (position) => {
    const fixture = await setup(true);
    await writeFile(join(fixture.cwd, "file"), "base");
    await fixture.emit("session_start", { reason: "startup" });
    const root = fixture.session.appendMessage(assistantMessage("unmapped root"));
    const first = fixture.session.appendMessage(assistantMessage("first"));
    await writeFile(join(fixture.cwd, "file"), "first");
    await fixture.emit("before_agent_start");
    const target = fixture.session.appendMessage({ role: "user", content: "continue", timestamp: 0 });
    await writeFile(join(fixture.cwd, "file"), "prompt");
    await fixture.emit("before_agent_start");
    fixture.session.appendMessage(assistantMessage("later descendant"));
    await writeFile(join(fixture.cwd, "file"), "later");
    await fixture.emit("before_agent_start");
    fixture.session.branch(first);
    fixture.session.appendMessage(assistantMessage("sibling"));
    await writeFile(join(fixture.cwd, "file"), "sibling");
    await fixture.emit("before_agent_start");
    await fixture.emit("session_shutdown");
    const parentId = fixture.session.getSessionId();
    const parentFile = fixture.session.getSessionFile();
    const before = await readCheckpointStore(fixture.storePath);
    const parent = before[parentId];
    if (!parent) throw new Error("Parent checkpoints were not saved");

    fixture.session.createBranchedSession(position === "at" ? target : first);
    const child = recordExtension({ exec: fixture.exec });
    checkpoint(child.api);
    await child.event("session_start")({ type: "session_start", reason: "fork", previousSessionFile: parentFile }, fixture.ctx);

    const saved = await readCheckpointStore(fixture.storePath);
    expect(saved[parentId]).toEqual(parent);
    expect(saved[fixture.session.getSessionId()]).toEqual({
      [BASE_CHECKPOINT_KEY]: parent[BASE_CHECKPOINT_KEY],
      [first]: parent[first],
      ...(position === "at" ? { [target]: parent[target] } : {}),
    });
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("sibling");
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    await child.event("session_before_fork")({ type: "session_before_fork", entryId: root, position: "at" }, fixture.ctx);
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("base");
  });

  it("persists inheritance before shutdown and carries child checkpoints into nested forks", async () => {
    const fixture = await history(true);
    await fixture.emit("session_shutdown");
    const parentFile = fixture.session.getSessionFile();
    fixture.session.createBranchedSession(fixture.second);
    const childId = fixture.session.getSessionId();
    const childFile = fixture.session.getSessionFile();
    if (!childFile) throw new Error("Child session was not persisted");
    const child = recordExtension({ exec: fixture.exec });
    checkpoint(child.api);
    await child.event("session_start")({ type: "session_start", reason: "fork", previousSessionFile: parentFile }, fixture.ctx);
    const inherited = (await readCheckpointStore(fixture.storePath))[childId];
    expect(inherited?.[fixture.second]).toBeDefined();

    const reopened = SessionManager.open(childFile);
    fixture.ctx.sessionManager = reopened;
    const reload = recordExtension({ exec: fixture.exec });
    checkpoint(reload.api);
    await reload.event("session_start")({ type: "session_start", reason: "resume" }, fixture.ctx);
    const third = reopened.appendMessage(assistantMessage("child turn"));
    await writeFile(join(fixture.cwd, "file"), "child change");
    await reload.event("before_agent_start")({ type: "before_agent_start", prompt: "next", systemPrompt: "test" } as Extract<ExtensionEvent, { type: "before_agent_start" }>, fixture.ctx);
    await reload.event("session_shutdown")({ type: "session_shutdown", reason: "fork" }, fixture.ctx);
    const childCheckpoints = (await readCheckpointStore(fixture.storePath))[childId];
    expect(childCheckpoints?.[fixture.first]).toBe(inherited?.[fixture.first]);
    expect(childCheckpoints?.[third]).toBeDefined();

    reopened.createBranchedSession(third);
    const nested = recordExtension({ exec: fixture.exec });
    checkpoint(nested.api);
    // Header lineage also works when Pi does not supply previousSessionFile.
    await nested.event("session_start")({ type: "session_start", reason: "fork" }, fixture.ctx);
    expect((await readCheckpointStore(fixture.storePath))[reopened.getSessionId()]).toEqual(childCheckpoints);
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    await nested.event("session_before_fork")({ type: "session_before_fork", entryId: fixture.second, position: "at" }, fixture.ctx);
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
  });

  it("does not replace existing fork checkpoints with a parent's later changes", async () => {
    const fixture = await history(true);
    await fixture.emit("session_shutdown");
    const parentId = fixture.session.getSessionId();
    const parentFile = fixture.session.getSessionFile();
    const original = (await readCheckpointStore(fixture.storePath))[parentId];
    if (!original) throw new Error("Parent checkpoints were not saved");
    fixture.session.createBranchedSession(fixture.second);
    const childId = fixture.session.getSessionId();
    await writeCheckpointStore(fixture.storePath, childId, new Map([[BASE_CHECKPOINT_KEY, original[fixture.second]!]]));
    const child = recordExtension({ exec: fixture.exec });
    checkpoint(child.api);
    await child.event("session_start")({ type: "session_start", reason: "fork", previousSessionFile: parentFile }, fixture.ctx);
    expect((await readCheckpointStore(fixture.storePath))[childId]).toEqual({ [BASE_CHECKPOINT_KEY]: original[fixture.second] });
  });

  it("inherits the original base when a fork retains no entries", async () => {
    const fixture = await history(true);
    await fixture.emit("session_shutdown");
    const parentFile = fixture.session.getSessionFile();
    const parent = (await readCheckpointStore(fixture.storePath))[fixture.session.getSessionId()];
    const childSession = SessionManager.create(fixture.cwd, fixture.session.getSessionDir(), { parentSession: parentFile });
    fixture.ctx.sessionManager = childSession;
    const child = recordExtension({ exec: fixture.exec });
    checkpoint(child.api);
    await child.event("session_start")({ type: "session_start", reason: "fork", previousSessionFile: parentFile }, fixture.ctx);
    expect((await readCheckpointStore(fixture.storePath))[childSession.getSessionId()]).toEqual({ [BASE_CHECKPOINT_KEY]: parent?.[BASE_CHECKPOINT_KEY] });
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
  });

  it("skips initial checkpoint capture and persistence when the fork parent file is missing", async () => {
    const fixture = await setup();
    const parentFile = join(fixture.root, "missing-parent.jsonl");

    await fixture.emit("session_start", { reason: "fork", previousSessionFile: parentFile });

    expect(fixture.refs()).toEqual([]);
    await expect(readFile(fixture.storePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(parentFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["broken JSON", "null", '{"type":"session","id":42}', '{"type":"message","id":"wrong"}'])("rejects an invalid parent header instead of guessing lineage: %s", async (contents) => {
    const fixture = await setup();
    const parentFile = join(fixture.root, "parent.jsonl");
    await writeFile(parentFile, contents);
    await expect(fixture.emit("session_start", { reason: "fork", previousSessionFile: parentFile })).rejects.toThrow("Invalid parent session header");
    expect(await readFile(parentFile, "utf8")).toBe(contents);
    await expect(readFile(fixture.storePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("checkpoint turn tracking", () => {
  it.each([
    { toolName: "write" }, { toolName: "edit" }, { toolName: "subagent" },
    { toolName: "write", parentToolCallId: "parent" }, { toolName: "edit", parentToolCallId: "parent" },
  ])("captures successful $toolName results with ancestry $parentToolCallId once at the turn leaf", async ({ toolName, parentToolCallId }) => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    const leaf = fixture.session.appendMessage(assistantMessage("result"));
    await fixture.emit("turn_start");
    fixture.exec.mockClear();
    await writeFile(join(fixture.cwd, "file"), "first mutation");
    await fixture.emit("tool_result", { toolName, parentToolCallId, toolCallId: "parent/1", isError: false });
    await writeFile(join(fixture.cwd, "file"), toolName);
    await fixture.emit("tool_result", { toolName, parentToolCallId, toolCallId: "parent/2", isError: false });
    await fixture.emit("turn_end");
    const saved = await fixture.saved();
    expect(fixture.exec.mock.calls.filter(([, args]) => args.includes("write-tree"))).toHaveLength(1);
    expect(fixture.git(fixture.directory, ["show", `${saved[leaf]}:file`])).toBe(toolName);
    await writeFile(join(fixture.cwd, "file"), "not another turn");
    await fixture.emit("turn_end");
    expect(await fixture.saved()).toEqual(saved);
  });

  it.each([
    { toolName: "write", isError: true }, { toolName: "edit", isError: true },
    { toolName: "subagent", isError: true }, { toolName: "read", isError: false },
    { toolName: "bash", isError: false },
    { toolName: "write", isError: true, parentToolCallId: "parent" },
    { toolName: "edit", isError: true, parentToolCallId: "parent" },
    { toolName: "mcp__fixture__mutate", isError: false, parentToolCallId: "parent" },
  ])("ignores $toolName with isError=$isError and ancestry $parentToolCallId", async ({ toolName, isError, parentToolCallId }) => {
    const fixture = await setup();
    await fixture.emit("session_start", { reason: "startup" });
    const before = await fixture.saved();
    fixture.session.appendMessage(assistantMessage("result"));
    await writeFile(join(fixture.cwd, "file"), "changed");
    await fixture.emit("tool_result", { toolName, isError, parentToolCallId });
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
    if (event === "session_before_tree") {
      expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
      expect(fixture.ui.notify).not.toHaveBeenCalled();
      fixture.session.branch(fixture.first);
      await fixture.emit("session_tree", { oldLeafId: fixture.second, newLeafId: fixture.first });
    }
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("base");
    expect(fixture.ui.select).toHaveBeenCalledWith("Restore code state?", ["Yes, restore code to that point", "No, keep current code"]);
    expect(fixture.ui.notify).toHaveBeenCalledWith("Code restored to checkpoint", "info");
  });

  it("leaves code untouched when navigation never completes and discards its restore on retry", async () => {
    const fixture = await history();
    fixture.ui.select.mockResolvedValueOnce("Yes, restore code to that point").mockResolvedValueOnce("No, keep current code");
    const preparation = { targetId: fixture.first, oldLeafId: fixture.second } as Extract<ExtensionEvent, { type: "session_before_tree" }>["preparation"];

    await fixture.emit("session_before_tree", { preparation });
    // Pi emits no session_tree when navigation is canceled or summarization fails.
    expect(fixture.session.getLeafId()).toBe(fixture.second);
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
    expect(fixture.ui.notify).not.toHaveBeenCalled();

    await fixture.emit("session_before_tree", { preparation });
    fixture.session.branch(fixture.first);
    await fixture.emit("session_tree", { oldLeafId: fixture.second, newLeafId: fixture.first });

    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
    expect(fixture.ui.notify).not.toHaveBeenCalled();
  });

  it("restores the selected user checkpoint even when navigation lands on its parent", async () => {
    const fixture = await history();
    fixture.session.branch(fixture.first);
    const target = fixture.session.appendMessage({ role: "user", content: "continue", timestamp: 0 });
    await writeFile(join(fixture.cwd, "file"), "prompt");
    await fixture.emit("before_agent_start");
    fixture.session.branch(fixture.second);
    await writeFile(join(fixture.cwd, "file"), "later");
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");

    await fixture.emit("session_before_tree", {
      preparation: { targetId: target, oldLeafId: fixture.second } as Extract<ExtensionEvent, { type: "session_before_tree" }>["preparation"],
    });
    fixture.session.branch(fixture.first);
    await fixture.emit("session_tree", { oldLeafId: fixture.second, newLeafId: fixture.first });

    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("prompt");
    expect(fixture.session.getLeafId()).toBe(fixture.first);
  });

  it.each(["exit", "throw"])("reports a restore %s failure after navigation without canceling or retrying", async (failure) => {
    const fixture = await history();
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    await fixture.emit("session_before_tree", {
      preparation: { targetId: fixture.first, oldLeafId: fixture.second } as Extract<ExtensionEvent, { type: "session_before_tree" }>["preparation"],
    });
    fixture.exec.mockImplementation((command, args, options) => {
      if (!args.includes("read-tree")) return fixture.api.exec(command, args, options);
      if (failure === "throw") return Promise.reject(new Error("restore denied"));
      return Promise.resolve({ code: 1, stderr: "restore denied", stdout: "", killed: false });
    });
    fixture.session.branch(fixture.first);

    expect(await fixture.emit("session_tree", { oldLeafId: fixture.second, newLeafId: fixture.first })).toBeUndefined();

    expect(fixture.session.getLeafId()).toBe(fixture.first);
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("later");
    expect(fixture.ui.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("restore denied"), "error");
    fixture.exec.mockClear();
    await fixture.emit("session_tree", { oldLeafId: fixture.second, newLeafId: fixture.first });
    expect(fixture.exec).not.toHaveBeenCalled();
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
    await fixture.emit("session_shutdown", { reason: "resume" });
    fixture.replaceExtension();
    await fixture.emit("session_start", { reason: "resume" });
    fixture.ui.select.mockResolvedValue("Yes, restore code to that point");
    expect(await fixture.emit("session_before_fork", { entryId: fixture.first, position: "at" })).toBeUndefined();
    expect(await readFile(join(fixture.cwd, "file"), "utf8")).toBe("base");
    expect(await fixture.saved()).toEqual(saved);
  });
});
