import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import commands from "../../../src/commands/index.js";
import { createState } from "../../../src/state.js";
import {
  assistantMessage,
  commandContext,
  commandWorkspace,
  PLAN_ID,
  planMetadata,
  storePlans,
} from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: vi.fn(),
    DefaultResourceLoader: vi.fn(
      class {
        reload = vi.fn(async () => {});
      },
    ),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAgentSession).mockReset();
  vi.unstubAllEnvs();
});

function sdkSession(
  manager: SessionManager,
  replies: Array<AssistantMessage | Error>,
  beforeReply: () => Promise<void>,
) {
  const listeners = new Set<Parameters<AgentSession["subscribe"]>[0]>();
  const session = {
    sessionId: manager.getSessionId(),
    messages: [],
    bindExtensions: vi.fn<AgentSession["bindExtensions"]>().mockResolvedValue(undefined),
    getAllTools: () => [],
    setActiveToolsByName: vi.fn<AgentSession["setActiveToolsByName"]>(),
    getContextUsage: () => undefined,
    subscribe: (listener: Parameters<AgentSession["subscribe"]>[0]) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prompt: vi.fn<AgentSession["prompt"]>(async () => {
      await beforeReply();
      const reply = replies.shift() ?? assistantMessage("New plan output");
      if (reply instanceof Error) throw reply;
      manager.appendMessage(reply);
      for (const listener of listeners) listener({ type: "message_end", message: reply });
    }),
    abort: vi.fn<AgentSession["abort"]>().mockResolvedValue(undefined),
    extensionRunner: { emit: vi.fn().mockResolvedValue(undefined) },
    dispose: vi.fn<AgentSession["dispose"]>(),
  };
  return session;
}

async function setup() {
  const cwd = await commandWorkspace();
  const home = join(cwd, "home");
  await mkdir(home);
  vi.stubEnv("HOME", home);
  await mkdir(join(cwd, ".pi", "agents"));
  for (const agent of ["planner", "documenter"]) {
    await writeFile(
      join(cwd, ".pi", "agents", `${agent}.md`),
      `---\ndescription: Test ${agent}\n---\nTest ${agent} instructions\n`,
    );
  }
  const extension = recordExtension({ events: createEventBus() });
  const state = createState(
    extension.api,
    { name: "assistant", body: "", meta: { description: "Test assistant" }, filePath: "" },
    "assistant",
  );
  onTestFinished(() => state.dispose());
  commands(extension.api);
  const context = commandContext(cwd);
  const replies: Array<AssistantMessage | Error> = [];
  const sessions: ReturnType<typeof sdkSession>[] = [];
  const beforeReply = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.mocked(createAgentSession).mockImplementation(async (options) => {
    if (!options?.sessionManager) throw new Error("Missing SDK session manager");
    const session = sdkSession(options.sessionManager, replies, beforeReply);
    sessions.push(session);
    return { session: session as unknown as AgentSession } as Awaited<
      ReturnType<typeof createAgentSession>
    >;
  });
  const save = () =>
    context.interact((component) => {
      component.handleInput?.("\t");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
    });
  const run = (name: "init" | "plan", input = "") =>
    extension.command(name).handler(input, context.ctx);
  const seed = async (title = "Saved plan", pid = "parent-session") => {
    const manager = SessionManager.create(cwd, join(cwd, ".pi", "subsessions"));
    manager.appendMessage(assistantMessage("Saved plan output"));
    await storePlans(cwd, { [manager.getSessionId()]: planMetadata(title, pid) });
    return manager;
  };
  return { cwd, extension, ...context, replies, sessions, beforeReply, save, run, seed };
}

describe("command lifecycle", () => {
  it("registers documented commands and defers completions until a session starts", async () => {
    const { extension } = await setup();
    expect(extension.command("init").description).toContain("AGENTS.md");
    expect(extension.command("plan").description).toContain("plan");
    expect(extension.command("plan").getArgumentCompletions?.("")).toBeNull();
  });

  it("updates completion scope when session and workspace change", async () => {
    const { cwd, extension, ctx } = await setup();
    const otherCwd = await commandWorkspace();
    await storePlans(cwd, { [PLAN_ID]: planMetadata("First plan") });
    await storePlans(otherCwd, { other: planMetadata("Second plan", "other-parent") });
    const complete = extension.command("plan").getArgumentCompletions!;

    await extension.event("session_start")({ type: "session_start", reason: "startup" }, ctx);
    expect(await complete("")).toEqual([{ value: PLAN_ID, label: "First plan" }]);
    await extension.event("session_start")(
      { type: "session_start", reason: "resume" },
      {
        ...ctx,
        cwd: otherCwd,
        sessionManager: { ...ctx.sessionManager, getSessionId: () => "other-parent" },
      },
    );
    expect(await complete("")).toEqual([{ value: "other", label: "Second plan" }]);
  });

  it.each(["init", "plan"])("rejects headless /%s without creating a subsession", async (name) => {
    const { extension, ctx, ui } = await setup();

    await extension.command(name).handler("request", { ...ctx, hasUI: false });

    expect(ui.notify).toHaveBeenCalledWith(`/${name} requires interactive UI`, "error");
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(ui.custom).not.toHaveBeenCalled();
  });
});

describe("/init contract", () => {
  it("runs the documenter instruction task, reports success, and clears progress", async () => {
    const { run, sessions, ui } = await setup();

    await run("init");

    const session = sessions[0]!;
    expect(session.prompt).toHaveBeenCalledWith(
      expect.stringContaining("create or update AGENTS.md"),
    );
    const options = vi.mocked(DefaultResourceLoader).mock.calls[0]?.[0];
    expect(options?.systemPromptOverride?.("")).toContain("Test documenter instructions");
    expect(ui.setWidget).toHaveBeenCalledWith("documenter", expect.any(Function));
    expect(ui.notify).toHaveBeenCalledWith("AGENTS.md initialization finished", "info");
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({
      type: "session_shutdown",
      reason: "quit",
    });
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenLastCalledWith("documenter", undefined);
  });

  it("reports startup failure without executing a turn", async () => {
    const { run, sessions, ui } = await setup();
    vi.mocked(createAgentSession).mockRejectedValueOnce(new Error("SDK unavailable"));

    await run("init");

    expect(sessions).toEqual([]);
    expect(ui.notify).toHaveBeenCalledWith("SDK unavailable", "error");
    expect(ui.setWidget).toHaveBeenLastCalledWith("documenter", undefined);
  });

  it.each(["error", "aborted"])(
    "reports %s execution without a success notification",
    async (status) => {
      const { run, replies, sessions, ui } = await setup();
      replies.push(
        status === "error"
          ? new Error("Execution failed")
          : { ...assistantMessage("Cancelled"), stopReason: "aborted" },
      );

      await run("init");

      expect(ui.notify).toHaveBeenCalledWith(
        status === "error" ? "Execution failed" : "Cancelled",
        "error",
      );
      expect(ui.notify).not.toHaveBeenCalledWith(expect.anything(), "info");
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
      expect(ui.setWidget).toHaveBeenLastCalledWith("documenter", undefined);
    },
  );

  it("disposes the documenter when a progress callback throws", async () => {
    const { run, sessions, ui } = await setup();
    ui.setWidget.mockImplementationOnce(() => {
      throw new Error("Progress failed");
    });

    await expect(run("init")).rejects.toThrow("Progress failed");

    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenLastCalledWith("documenter", undefined);
  });
});

describe("/plan contract", () => {
  it("starts a planner with trimmed input and opens its review", async () => {
    const { cwd, run, sessions, save, ui } = await setup();
    save();

    await run("plan", "  Plan cache changes \n");

    expect(sessions[0]?.prompt).toHaveBeenCalledWith("Plan cache changes");
    const store = JSON.parse(await readFile(join(cwd, ".pi", "subsessions.json"), "utf8"));
    expect(store[sessions[0]!.sessionId]).toMatchObject({
      agent: "planner",
      label: "plan",
      pid: "parent-session",
    });
    expect(ui.custom).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenCalledWith("planner", expect.any(Function));
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
  });

  it.each(["id", "picker"])(
    "resumes a saved plan through %s without submitting another prompt",
    async (route) => {
      const { run, seed, sessions, save, interact, cwd } = await setup();
      const manager = await seed();
      if (route === "picker") interact((component) => component.handleInput?.("\r"));
      save();

      await run("plan", route === "id" ? manager.getSessionId() : "");

      expect(sessions[0]?.sessionId).toBe(manager.getSessionId());
      expect(sessions[0]?.prompt).not.toHaveBeenCalled();
      expect(
        await readFile(join(cwd, ".pi", "plans", `${manager.getSessionId()}.md`), "utf8"),
      ).toBe("Saved plan output\n");
    },
  );

  it("warns on an empty plan list without creating a session", async () => {
    const { run, ui } = await setup();

    await run("plan");

    expect(ui.notify).toHaveBeenCalledWith("No stored plan sessions", "warning");
    expect(ui.custom).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });

  it("starts no session when the picker is cancelled", async () => {
    const { run, seed, interact, ui } = await setup();
    await seed();
    interact((component) => component.handleInput?.("\x1b"));

    await run("plan");

    expect(createAgentSession).not.toHaveBeenCalled();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });

  it.each(["missing", "foreign"])(
    "rejects a %s plan ID without starting a session",
    async (kind) => {
      const { run, seed, ui } = await setup();
      const manager = kind === "foreign" ? await seed("Foreign plan", "other-parent") : undefined;

      await run("plan", manager?.getSessionId() ?? PLAN_ID);

      expect(createAgentSession).not.toHaveBeenCalled();
      expect(ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Subsession not found:"),
        "error",
      );
      expect(ui.custom).not.toHaveBeenCalled();
      expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
    },
  );

  it("reports unavailable startup and skips the review", async () => {
    const { run, ui } = await setup();
    vi.mocked(createAgentSession).mockRejectedValueOnce(new Error("SDK unavailable"));

    await run("plan", "New request");

    expect(ui.notify).toHaveBeenCalledWith("SDK unavailable", "error");
    expect(ui.custom).not.toHaveBeenCalled();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });

  it("disposes a failed planner turn and reports its error before review", async () => {
    const { run, replies, sessions, ui } = await setup();
    replies.push(new Error("Planner failed"));

    await run("plan", "New request");

    expect(ui.notify).toHaveBeenCalledWith("Planner failed", "error");
    expect(ui.custom).not.toHaveBeenCalled();
    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
    expect(ui.setWidget).toHaveBeenLastCalledWith("planner", undefined);
  });

  it.each([false, true])("reports picker deletion outcome when storage fails=%j", async (fails) => {
    const { cwd, seed, run, interact, ui } = await setup();
    const manager = await seed();
    const notified = Promise.withResolvers<void>();
    ui.notify.mockImplementation(() => notified.resolve());
    interact(async (component) => {
      if (fails) await writeFile(join(cwd, ".pi", "subsessions.json"), "{broken");
      component.handleInput?.("\x04");
      component.handleInput?.("\r");
      await notified.promise;
      component.handleInput?.("\x1b");
    });

    await run("plan");

    expect(ui.notify).toHaveBeenCalledWith(
      fails ? "Failed to delete plan session" : "Deleted plan session",
      fails ? "error" : "info",
    );
    if (fails) {
      expect(await readFile(manager.getSessionFile()!, "utf8")).toContain("Saved plan output");
    } else {
      await expect(readFile(manager.getSessionFile()!)).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(join(cwd, ".pi", "subsessions.json"), "utf8"))).toEqual({});
    }
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  // Known leak: resolvePlan has no disposal guard around its initial exec/save.
  it.fails("disposes the planner when initial result persistence throws", async () => {
    const { cwd, run, beforeReply, sessions } = await setup();
    beforeReply.mockImplementationOnce(async () => {
      await mkdir(join(cwd, ".pi", "subsessions.json"));
    });

    await expect(run("plan", "New request")).rejects.toBeInstanceOf(Error);

    expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
  });
});
