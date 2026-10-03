import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPlanLoop } from "../../../src/commands/helpers.js";
import type { Subsession } from "../../../src/subagent/types.js";
import { assistantMessage, commandContext, commandWorkspace, PLAN_ID, planMetadata, storePlans } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn(actual.unlink), writeFile: vi.fn(actual.writeFile) };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(unlink).mockReset();
  vi.mocked(writeFile).mockReset();
  vi.mocked(spawn).mockReset();
});

async function setup() {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(unlink).mockImplementation(actual.unlink);
  vi.mocked(writeFile).mockImplementation(actual.writeFile);
  const cwd = await commandWorkspace();
  const context = commandContext(cwd);
  const extension = recordExtension();
  const session: Subsession = {
    pid: "parent-session",
    label: "plan",
    title: "Test plan",
    result: {
      id: PLAN_ID, status: "done", output: "  Initial plan  \n\n",
      usage: {
        input: 0, output: 0, toolCalls: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      toolCounts: {},
    },
    runtime: { agent: "planner", builtIn: false, meta: { description: "Test planner" }, systemPrompt: "" },
    exec: vi.fn<Subsession["exec"]>(),
    dispose: vi.fn<Subsession["dispose"]>(),
  };
  await storePlans(cwd, { [PLAN_ID]: planMetadata() });
  const outputPath = join(cwd, ".pi", "plans", `${PLAN_ID}.md`);
  const run = () => runPlanLoop(extension.api, context.ctx, session);
  const action = (kind: "save" | "forward" | "open", hasPath = true) => {
    context.interact((component) => {
      component.handleInput?.("\t");
      const offset = kind === "forward" ? 0 : kind === "open" ? 1 : hasPath ? 2 : 1;
      for (let index = 0; index < offset; index++) component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
    });
  };
  return { cwd, ...context, extension, session, outputPath, run, action, actual };
}

describe("plan review persistence", () => {
  it("saves normalized output and retains its resumable session", async () => {
    const { cwd, session, outputPath, run, action, ui } = await setup();
    action("save");

    await run();

    expect(await readFile(outputPath, "utf8")).toBe("  Initial plan\n");
    expect(JSON.parse(await readFile(join(cwd, ".pi", "subsessions.json"), "utf8"))).toHaveProperty(PLAN_ID);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining(`/plan ${PLAN_ID}`), "info");
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });

  it("saves and presents the revised output after feedback", async () => {
    const { session, outputPath, run, interact } = await setup();
    vi.mocked(session.exec).mockImplementation(async () => { session.result.output = "Revised plan"; });
    interact((component) => {
      component.handleInput?.("\t");
      for (let index = 0; index < 3; index++) component.handleInput?.("\x1b[B");
      component.handleInput?.("Include rollback");
      component.handleInput?.("\r");
    });
    interact((component) => {
      expect(component.render(100).join("\n")).toContain("Revised plan");
      component.handleInput?.("\t");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
    });

    await run();

    expect(session.exec).toHaveBeenCalledWith("Include rollback");
    expect(await readFile(outputPath, "utf8")).toBe("Revised plan\n");
  });

  it("reports write failure without claiming success, and permits saving after recovery", async () => {
    const { cwd, outputPath, ui, run, action, interact } = await setup();
    await rm(join(cwd, ".pi", "plans"), { recursive: true });
    action("save", false);
    interact(async (component) => {
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Failed to save plan:"), "error");
      expect(ui.notify).not.toHaveBeenCalledWith(expect.anything(), "info");
      expect(component.render(100).join("\n")).not.toContain("Open plan in external editor");
      await mkdir(join(cwd, ".pi", "plans"));
      component.handleInput?.("\t");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
    });
    action("save");

    await run();

    expect(await readFile(outputPath, "utf8")).toBe("  Initial plan\n");
    expect(ui.notify).toHaveBeenLastCalledWith(expect.stringContaining(outputPath), "info");
    expect(ui.notify.mock.calls.some(([message]) => message.includes("Saved plan to null"))).toBe(false);
  });

  it("reports a missing session ID without inventing an output file", async () => {
    const { session, ui, run, interact, outputPath } = await setup();
    delete session.result.id;
    interact((component) => component.handleInput?.("\x1b"));

    await run();

    expect(ui.notify).toHaveBeenCalledWith("Failed to save plan: missing subsession ID", "error");
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it.each(["ui", "feedback"])("disposes the session and clears progress when %s throws", async (failure) => {
    const { session, ui, interact, run } = await setup();
    if (failure === "ui") {
      ui.custom.mockRejectedValueOnce(new Error("review failed"));
    } else {
      vi.mocked(session.exec).mockRejectedValueOnce(new Error("review failed"));
      interact((component) => {
        component.handleInput?.("\t");
        for (let index = 0; index < 3; index++) component.handleInput?.("\x1b[B");
        component.handleInput?.("Revise");
        component.handleInput?.("\r");
      });
    }

    await expect(run()).rejects.toThrow("review failed");

    expect(session.dispose).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });
});

describe("plan actions", () => {
  it.each(["discard", "forward"] as const)("removes plan artifacts in the background after %s", async (kind) => {
    const { cwd, session, run, interact, action, extension, actual } = await setup();
    const manager = SessionManager.create(cwd, join(cwd, ".pi", "subsessions"));
    manager.appendMessage(assistantMessage("Stored plan"));
    session.result.id = manager.getSessionId();
    const transcript = manager.getSessionFile()!;
    const planPath = join(cwd, ".pi", "plans", `${session.result.id}.md`);
    await storePlans(cwd, { [session.result.id]: planMetadata() });
    const deleted = Promise.withResolvers<void>();
    vi.mocked(unlink).mockImplementation(async (path) => {
      await actual.unlink(path);
      if (path === transcript) deleted.resolve();
    });
    if (kind === "forward") action("forward");
    else interact((component) => component.handleInput?.("\x1b"));

    await run();
    await deleted.promise;

    await expect(readFile(planPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(transcript)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(cwd, ".pi", "subsessions.json"), "utf8"))).toEqual({});
    expect(session.dispose).toHaveBeenCalledOnce();
    if (kind === "forward") {
      expect(extension.api.sendUserMessage).toHaveBeenCalledExactlyOnceWith("Initial plan");
    } else {
      expect(extension.api.sendUserMessage).not.toHaveBeenCalled();
    }
  });

  it.each(["empty", "dispatch"])("retains the plan when forwarding fails due to %s", async (failure) => {
    const { cwd, session, ui, outputPath, extension, run, action } = await setup();
    if (failure === "empty") session.result.output = " \n ";
    else vi.mocked(extension.api.sendUserMessage).mockImplementationOnce(() => { throw new Error("dispatch failed"); });
    action("forward");
    action("save");

    await run();

    expect(ui.notify).toHaveBeenCalledWith(
      failure === "empty" ? "No plan to forward" : "Failed to forward plan",
      failure === "empty" ? "warning" : "error",
    );
    expect(await readFile(outputPath, "utf8")).toBe(`${session.result.output.trimEnd()}\n`);
    expect(JSON.parse(await readFile(join(cwd, ".pi", "subsessions.json"), "utf8"))).toHaveProperty(PLAN_ID);
    if (failure === "empty") expect(extension.api.sendUserMessage).not.toHaveBeenCalled();
  });

  it.each([0, 1])("opens the saved file and returns to review after editor exit %i", async (exitCode) => {
    const { cwd, outputPath, ui, run, action } = await setup();
    const settings = SettingsManager.inMemory({ externalEditor: "fake-editor --wait" });
    vi.spyOn(SettingsManager, "create").mockReturnValue(settings);
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", exitCode));
      return child as ReturnType<typeof spawn>;
    });
    action("open");
    action("save");

    await run();

    expect(spawn).toHaveBeenCalledWith("fake-editor", ["--wait", outputPath], expect.objectContaining({ stdio: "inherit" }));
    expect(SettingsManager.create).toHaveBeenCalledWith(cwd, undefined, { projectTrusted: true });
    expect(ui.custom).toHaveBeenCalledTimes(2);
    if (exitCode !== 0) expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Failed to open"), "error");
  });

  it.each(["ENOENT", "EACCES"])("continues session removal after Markdown deletion error %s", async (code) => {
    const { cwd, session, ui, run, interact, actual } = await setup();
    const removed = Promise.withResolvers<void>();
    const error = Object.assign(new Error("cannot unlink"), { code });
    const manager = SessionManager.create(cwd, join(cwd, ".pi", "subsessions"));
    manager.appendMessage(assistantMessage("Stored plan"));
    session.result.id = manager.getSessionId();
    await storePlans(cwd, { [session.result.id]: planMetadata() });
    const transcript = manager.getSessionFile()!;
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (String(path).endsWith(".md")) {
        if (code === "ENOENT") await actual.unlink(path);
        throw error;
      }
      await actual.unlink(path);
      if (path === transcript) removed.resolve();
    });
    interact((component) => component.handleInput?.("\x1b"));

    await run();
    await removed.promise;

    if (code === "EACCES") expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Failed to delete plan:"), "error");
    else expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("Failed to delete"), "error");
  });
});
