import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { SettingsManager, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openInEditor, runCommand } from "../../../src/utils.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough };
const platform = process.platform;

beforeEach(() => {
  child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  vi.mocked(spawn).mockReset().mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});

afterEach(() => {
  child.stdout.destroy();
  child.stderr.destroy();
  child.removeAllListeners();
  Object.defineProperty(process, "platform", { value: platform });
  vi.restoreAllMocks();
});

describe("command execution", () => {
  it.each(["linux", "win32"])("passes arguments and cwd without a shell on %s", async (current) => {
    Object.defineProperty(process, "platform", { value: current });
    const controller = new AbortController();

    const pending = runCommand("/workspace", "runner", ["literal; argument"], { signal: controller.signal });
    child.stdout.write(Buffer.from("first "));
    child.stdout.write(Buffer.from("second"));
    child.stderr.write(Buffer.from("warning"));
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({ stdout: "first second", stderr: "warning", exitCode: 0 });
    expect(spawn).toHaveBeenCalledWith(current === "win32" ? "runner.cmd" : "runner", ["literal; argument"], {
      cwd: "/workspace", env: process.env, signal: controller.signal, stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("accepts configured nonzero exit codes", async () => {
    const pending = runCommand("/workspace", "runner", [], { successExitCodes: [2] });
    child.emit("close", 2);

    await expect(pending).resolves.toEqual({ stdout: "", stderr: "", exitCode: 2 });
  });

  it.each([
    { code: 2, stderr: " \n denied \n", message: "runner --check failed with exit code 2: denied" },
    { code: 1, stderr: " \n", message: "runner --check failed with exit code 1" },
    { code: null, stderr: "", message: "runner --check failed with exit code unknown" },
  ])("reports exit $code with relevant stderr", async ({ code, stderr, message }) => {
    const pending = runCommand("/workspace", "runner", ["--check"]);
    child.stderr.write(stderr);
    child.emit("close", code);

    await expect(pending).rejects.toThrow(message);
  });

  it("preserves asynchronous spawn errors", async () => {
    const error = Object.assign(new Error("executable missing"), { code: "ENOENT" });
    const pending = runCommand("/workspace", "runner", []);
    child.emit("error", error);
    child.emit("close", -2);

    await expect(pending).rejects.toBe(error);
  });

  it("preserves synchronous spawn errors", async () => {
    const error = new TypeError("invalid process options");
    vi.mocked(spawn).mockImplementation(() => { throw error; });

    await expect(runCommand("/workspace", "runner", [])).rejects.toBe(error);
  });

  it.each([undefined, "stop requested"])("does not spawn an already aborted command with message %j", async (abortMessage) => {
    const controller = new AbortController();
    controller.abort();

    await expect(runCommand("/workspace", "runner", [], { signal: controller.signal, abortMessage }))
      .rejects.toThrow(abortMessage ?? "command aborted");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses the requested cancellation message when abort emits an error before close", async () => {
    const controller = new AbortController();
    const pending = runCommand("/workspace", "runner", [], { signal: controller.signal, abortMessage: "stop requested" });
    controller.abort();
    child.emit("error", Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" }));
    child.emit("close", null);

    await expect(pending).rejects.toThrow("stop requested");
    expect(vi.mocked(spawn).mock.calls[0]?.[2]?.signal).toBe(controller.signal);
  });

  it("rejects an aborted command even if the child closes with a successful code", async () => {
    const controller = new AbortController();
    const pending = runCommand("/workspace", "runner", [], { signal: controller.signal });
    controller.abort();
    child.emit("close", 0);

    await expect(pending).rejects.toThrow("command aborted");
  });
});

describe("external editor", () => {
  function context(command: string, trusted = false) {
    const settings = SettingsManager.inMemory();
    vi.spyOn(settings, "getExternalEditorCommand").mockReturnValue(command);
    vi.spyOn(SettingsManager, "create").mockReturnValue(settings);
    const notify = vi.fn<ExtensionCommandContext["ui"]["notify"]>();
    const ctx = { cwd: "/workspace", isProjectTrusted: () => trusted, ui: { notify } } as unknown as ExtensionCommandContext;
    return { ctx, notify };
  }

  it.each([
    { current: "linux", trusted: false }, { current: "win32", trusted: true },
  ])("opens a file with inherited terminal and project trust on $current", async ({ current, trusted }) => {
    Object.defineProperty(process, "platform", { value: current });
    const { ctx, notify } = context("editor --wait", trusted);

    const pending = openInEditor(ctx, "/workspace/file name.ts");
    child.emit("close", 0);

    await expect(pending).resolves.toBe(true);
    expect(SettingsManager.create).toHaveBeenCalledWith("/workspace", undefined, { projectTrusted: trusted });
    expect(spawn).toHaveBeenCalledWith("editor", ["--wait", "/workspace/file name.ts"], {
      stdio: "inherit", shell: current === "win32",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports an empty editor command without spawning", async () => {
    const { ctx, notify } = context(" \t ");

    await expect(openInEditor(ctx, "file.ts")).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("External editor command is empty", "error");
  });

  it.each(["error", "nonzero", "signal"])("reports editor failure on %s", async (outcome) => {
    const { ctx, notify } = context("editor");
    const pending = openInEditor(ctx, "file.ts");
    if (outcome === "error") child.emit("error", new Error("editor unavailable"));
    child.emit("close", outcome === "nonzero" ? 1 : null);

    await expect(pending).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Failed to open file.ts"), "error");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
