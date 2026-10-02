import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { AgentMode } from "../../../src/agent/types.js";
import { createState, getState, STATE_EVENT } from "../../../src/state.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionSession, makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

let workspace: PermissionWorkspace;

beforeEach(async () => {
  const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(writeFile).mockReset().mockImplementation(original.writeFile);
  onTestFinished(() => { vi.mocked(writeFile).mockReset(); });
  workspace = await makePermissionWorkspace("surgent-state-contract-");
  onTestFinished(workspace.restore);
  vi.stubEnv("USERPROFILE", workspace.home);
  onTestFinished(() => { vi.unstubAllEnvs(); });
});

describe("shared state event contract", () => {
  it("rejects lookup when no state provider is registered", () => {
    const pi = recordExtension({ events: createEventBus() });

    expect(() => getState(pi.api)).toThrow("Session state is unavailable");
  });

  it.each(["assistant", "restricted", "yolo"] as const)("publishes the supplied agent and %s mode to consumers", (mode) => {
    const meta = { description: "session agent" };
    const pi = makePermissionSession(meta, mode);

    const shared = getState(pi.api);

    expect(shared.getAgent()).toEqual({ name: "main", body: "", filePath: "main.md", meta });
    expect(shared.getMode()).toBe(mode);
  });

  it("isolates providers on separate event buses, including disposal", () => {
    const first = makePermissionSession({ description: "first" }, "restricted");
    const second = makePermissionSession({ description: "second" }, "yolo");

    expect(getState(first.api).getAgent().meta.description).toBe("first");
    expect(getState(first.api).getMode()).toBe("restricted");
    first.state.dispose();

    expect(() => getState(first.api)).toThrow("Session state is unavailable");
    expect(getState(second.api).getAgent().meta.description).toBe("second");
    expect(getState(second.api).getMode()).toBe("yolo");
  });

  it("unsubscribes on repeated disposal and rejects access through stale handles", async () => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);
    const reply = vi.fn();

    pi.state.dispose();
    pi.state.dispose();
    pi.api.events.emit(STATE_EVENT, reply);

    expect(reply).not.toHaveBeenCalled();
    expect(() => getState(pi.api)).toThrow("Session state is unavailable");
    for (const handle of [shared, pi.state]) {
      expect(() => handle.getAgent()).toThrow("Session state is unavailable");
      expect(() => handle.getMode()).toThrow("Session state is unavailable");
      await expect(handle.setMode("yolo")).rejects.toThrow("Session state is unavailable");
    }
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("serves only the replacement provider after a session is disposed", () => {
    const pi = makePermissionSession();
    const stale = getState(pi.api);
    const agent = { ...stale.getAgent(), name: "replacement" };
    pi.state.dispose();
    const replacement = createState(pi.api, agent, "restricted");
    onTestFinished(() => replacement.dispose());
    const reply = vi.fn();

    pi.api.events.emit(STATE_EVENT, reply);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(getState(pi.api).getAgent()).toEqual(agent);
    expect(getState(pi.api).getMode()).toBe("restricted");
    expect(() => stale.getMode()).toThrow("Session state is unavailable");
  });
});

describe("shared mode update contract", () => {
  it.each(["", "invalid", null])("rejects invalid runtime mode %j without writing or poisoning later updates", async (mode) => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);

    await expect(shared.setMode(mode as AgentMode)).rejects.toThrow("Invalid agent mode");
    expect(shared.getMode()).toBe("assistant");
    expect(writeFile).not.toHaveBeenCalled();
    await shared.setMode("restricted");

    expect(shared.getMode()).toBe("restricted");
    await expect(readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8"))
      .resolves.toContain('"mode": "restricted"');
  });

  it("persists queued updates in request order and exposes them to existing consumers", async () => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);
    const modes: AgentMode[] = ["yolo", "restricted", "assistant"];
    const observed: AgentMode[] = [];

    await Promise.all(modes.map((mode) => shared.setMode(mode).then(() => {
      observed.push(shared.getMode());
    })));

    expect(observed).toEqual(modes);
    expect(pi.state.getMode()).toBe("assistant");
    expect(getState(pi.api).getMode()).toBe("assistant");
    expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
      .toMatchObject({ agent: { mode: "assistant" } });
  });

  it("allows an already queued update to succeed after an earlier persistence failure", async () => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);
    const failure = new Error("write failed");
    vi.mocked(writeFile).mockRejectedValueOnce(failure);

    const results = await Promise.allSettled([shared.setMode("yolo"), shared.setMode("restricted")]);

    expect(results).toEqual([{ status: "rejected", reason: failure }, { status: "fulfilled", value: undefined }]);
    expect(shared.getMode()).toBe("restricted");
    expect(pi.state.getMode()).toBe("restricted");
    expect(JSON.parse(await readFile(join(workspace.home, ".pi", "agent", "settings.json"), "utf8")))
      .toMatchObject({ agent: { mode: "restricted" } });
  });

  it("rejects queued updates disposed before they start without persisting them", async () => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);

    const update = shared.setMode("yolo");
    pi.state.dispose();

    await expect(update).rejects.toThrow("Session state is unavailable");
    expect(writeFile).not.toHaveBeenCalled();
    expect(() => getState(pi.api)).toThrow("Session state is unavailable");
  });

  it("rejects active and queued updates on disposal, allowing only the active write to finish", async () => {
    const pi = makePermissionSession();
    const shared = getState(pi.api);
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return original.writeFile(...args);
    });
    const update = shared.setMode("yolo");
    const queued = shared.setMode("restricted");
    const settled = Promise.allSettled([update, queued]);

    try {
      await writing;
      pi.state.dispose();
      release();

      await expect(update).rejects.toThrow("Session state is unavailable");
      await expect(queued).rejects.toThrow("Session state is unavailable");
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(() => getState(pi.api)).toThrow("Session state is unavailable");
      expect(() => shared.getMode()).toThrow("Session state is unavailable");
    } finally {
      release();
      await settled;
    }
  });
});
