import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createErrorResult } from "../../../src/subagent/helpers.js";
import { findSubsession, findSubsessionFile, loadSubsessionOutput, resolveRuntime, saveSubsession, terminateSubsession } from "../../../src/subagent/storage.js";
import type { Subsession } from "../../../src/subagent/types.js";
import { agentWorkspace } from "../../helpers/agent.js";
import { assistantMessage } from "../../helpers/commands.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

function subsession(overrides: Partial<Subsession> = {}): Subsession {
  return {
    pid: "parent", title: "Existing", runtime: { agent: "worker", builtIn: false, meta: { description: "Worker" }, systemPrompt: "Instructions" },
    result: { ...createErrorResult("# Plan: Saved"), id: "child", status: "done" },
    exec: vi.fn(), dispose: vi.fn(), ...overrides,
  };
}

async function setup() {
  const workspace = await agentWorkspace();
  const directory = join(workspace.cwd, ".pi", "subsessions");
  await mkdir(directory);
  return { ...workspace, directory, store: join(workspace.cwd, ".pi", "subsessions.json") };
}

describe("subsession metadata", () => {
  it.each([
    ["# Plan: Build feature", "Build feature"], ["# Plain title", "Plain title"],
    ["Preamble\n# Plan: First\n# Second", "First"], ["# Plan: Part: Detail", "Part: Detail"],
    ["## Not a title", "Untitled"], ["", "Untitled"], ["# Plan:   ", "Untitled"], ["#   ", "Untitled"],
  ])("stores title extracted from %j", async (output, title) => {
    const { cwd } = await setup();
    const child = subsession();
    child.result.output = output;
    await saveSubsession(cwd, child);
    expect((await findSubsession(cwd, "child", "parent"))?.title).toBe(title);
    expect(child.title).toBe(title);
  });

  it.each(["error", "aborted"] as const)("preserves saved title after %s", async (status) => {
    const { cwd } = await setup();
    const child = subsession();
    child.result.status = status;
    await saveSubsession(cwd, child);
    expect((await findSubsession(cwd, "child"))?.title).toBe("Existing");
  });

  it("updates a record without losing unrelated sessions", async () => {
    const { cwd } = await setup();
    const first = subsession();
    await saveSubsession(cwd, first);
    const second = subsession({ pid: "other-parent" });
    second.result.id = "other";
    await saveSubsession(cwd, second);
    first.result.output = "# Updated";
    first.result.usage.input = 12;
    await saveSubsession(cwd, first);
    expect(await findSubsession(cwd, "child", "parent")).toMatchObject({ agent: "worker", title: "Updated", usage: { input: 12 } });
    expect(await findSubsession(cwd, "other", "other-parent")).toMatchObject({ title: "Saved" });
    expect(await findSubsession(cwd, "child", "other-parent")).toBeNull();
    expect(await findSubsession(cwd, "unknown")).toBeNull();
    expect(await findSubsession(cwd)).toBeNull();
  });

  it("does not persist temporary or unidentified sessions", async () => {
    const { cwd, store } = await setup();
    await saveSubsession(cwd, subsession({ temporary: true }));
    const unidentified = subsession();
    delete unidentified.result.id;
    await saveSubsession(cwd, unidentified);
    await expect(readFile(store)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats missing stores as empty and rejects corrupt stores without replacing them", async () => {
    const { cwd, store } = await setup();
    expect(await findSubsession(cwd, "child")).toBeNull();
    await writeFile(store, "broken JSON");
    await expect(findSubsession(cwd, "child")).rejects.toThrow();
    await expect(saveSubsession(cwd, subsession())).rejects.toThrow();
    await expect(terminateSubsession(cwd, "child")).rejects.toThrow();
    expect(await readFile(store, "utf8")).toBe("broken JSON");
  });
});

describe("subsession transcripts", () => {
  it("finds matching session and reads last assistant text on the active branch", async () => {
    const { cwd, directory } = await setup();
    const manager = SessionManager.create(cwd, directory);
    const base = manager.appendMessage(assistantMessage("base"));
    manager.appendMessage(assistantMessage("abandoned"));
    manager.branch(base);
    const message = assistantMessage("first block");
    message.content.push({ type: "text", text: "active answer" }, { type: "toolCall", id: "call", name: "read", arguments: { path: "file" } });
    manager.appendMessage(message);
    manager.appendMessage({ role: "user", content: "later question", timestamp: 0 });
    manager.appendCustomEntry("annotation", {});
    expect(await findSubsessionFile(cwd, manager.getSessionId())).toEqual({ path: manager.getSessionFile(), dir: directory });
    expect(await loadSubsessionOutput(cwd, manager.getSessionId())).toBe("active answer");
    expect(await findSubsessionFile(cwd, "missing")).toBeUndefined();
    expect(await loadSubsessionOutput(cwd, "missing")).toBe("");
  });

  it("returns empty output for transcripts without assistant text or with corrupt content", async () => {
    const { cwd, directory } = await setup();
    const manager = SessionManager.create(cwd, directory);
    const message = assistantMessage("");
    message.content = [{ type: "toolCall", id: "call", name: "read", arguments: { path: "file" } }];
    manager.appendMessage(message);
    expect(await loadSubsessionOutput(cwd, manager.getSessionId())).toBe("");
    await writeFile(manager.getSessionFile()!, "invalid transcript");
    expect(await loadSubsessionOutput(cwd, manager.getSessionId())).toBe("");
  });

  it("returns empty output when the SDK cannot open a saved transcript", async () => {
    const { cwd, directory } = await setup();
    const manager = SessionManager.create(cwd, directory);
    manager.appendMessage(assistantMessage("saved"));
    const open = vi.spyOn(SessionManager, "open").mockImplementationOnce(() => { throw new Error("Cannot open transcript"); });
    onTestFinished(() => open.mockRestore());
    expect(await loadSubsessionOutput(cwd, manager.getSessionId())).toBe("");
    expect(open).toHaveBeenCalledOnce();
  });

  it("deletes selected metadata and transcript while preserving other sessions", async () => {
    const { cwd, directory } = await setup();
    const manager = SessionManager.create(cwd, directory);
    manager.appendMessage(assistantMessage("delete me"));
    const child = subsession();
    child.result.id = manager.getSessionId();
    await saveSubsession(cwd, child);
    const other = subsession();
    await saveSubsession(cwd, other);
    await terminateSubsession(cwd, manager.getSessionId());
    expect(await findSubsession(cwd, manager.getSessionId())).toBeNull();
    await expect(readFile(manager.getSessionFile()!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await findSubsession(cwd, "child")).not.toBeNull();
    await expect(terminateSubsession(cwd, manager.getSessionId())).resolves.toBeUndefined();
  });

  it("surfaces transcript deletion failure instead of claiming successful termination", async () => {
    const { cwd, directory } = await setup();
    const manager = SessionManager.create(cwd, directory);
    manager.appendMessage(assistantMessage("preserved transcript"));
    const child = subsession();
    child.result.id = manager.getSessionId();
    await saveSubsession(cwd, child);
    const failure = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    vi.mocked(unlink).mockRejectedValueOnce(failure);
    onTestFinished(() => { vi.mocked(unlink).mockReset(); });
    await expect(terminateSubsession(cwd, manager.getSessionId())).rejects.toBe(failure);
    expect(await readFile(manager.getSessionFile()!, "utf8")).toContain("preserved transcript");
  });

  it("removes metadata even when its transcript is already absent", async () => {
    const { cwd } = await setup();
    await saveSubsession(cwd, subsession());
    await terminateSubsession(cwd, "child");
    expect(await findSubsession(cwd, "child")).toBeNull();
  });
});

describe("subagent runtime profiles", () => {
  it("loads custom prompt and metadata instead of marking them built-in", async () => {
    const { cwd, local } = await setup();
    await writeFile(join(local, "worker.md"), "---\ndescription: Worker profile\ntools: [read]\n---\nCustom instructions\n");
    expect(await resolveRuntime(cwd, "worker")).toMatchObject({ agent: "worker", builtIn: false, meta: { description: "Worker profile", tools: ["read"] } });
    expect((await resolveRuntime(cwd, "worker")).systemPrompt).toContain("Custom instructions");
  });

  it("identifies built-in profiles and rejects unknown profiles", async () => {
    const { cwd } = await setup();
    expect(await resolveRuntime(cwd, "planner")).toMatchObject({ agent: "planner", builtIn: true });
    await expect(resolveRuntime(cwd, "missing-agent")).rejects.toThrow();
  });
});
