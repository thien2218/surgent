import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export const cliPath = join(packageRoot, "bin", "surgent.js");
export const modelArgs = ["--model", "openai/gpt-4o-mini"];

export async function setupCli() {
  // Fail closed: every subprocess, including descendants, needs network isolation.
  if (process.platform !== "linux") throw new Error("CLI E2E requires Linux with unshare user/network namespaces");
  const root = await mkdtemp(join(tmpdir(), "surgent-e2e-"));
  const children = new Set<{ kill: () => void; done: Promise<unknown> }>();
  onTestFinished(async () => {
    for (const child of children) child.kill();
    await Promise.all([...children].map((child) => child.done));
    await rm(root, { recursive: true, force: true });
  });
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(home), mkdir(workspace), mkdir(join(root, "tmp"))]);
  // Allowlist rather than inheriting developer credentials, proxies, or NODE_OPTIONS.
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    TMPDIR: join(root, "tmp"),
    PI_OFFLINE: "1",
    AWS_EC2_METADATA_DISABLED: "true",
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: "C.UTF-8",
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CEILING_DIRECTORIES: root,
    npm_config_cache: join(home, ".npm"),
    npm_config_userconfig: join(home, ".npmrc"),
    npm_config_globalconfig: join(home, "npmrc"),
    npm_config_offline: "true",
  };

  function start(command: string, args: string[], cwd = workspace) {
    const child = spawn("unshare", ["--user", "--map-root-user", "--net", "--", command, ...args], {
      cwd, env, stdio: "pipe", detached: true,
    });
    let stdout = "";
    let stderr = "";
    const errors: string[] = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => errors.push(error.message));
    child.stdin.on("error", (error) => errors.push(error.message));
    function kill() {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    const deadline = setTimeout(() => {
      errors.push("CLI process did not finish within 30 seconds");
      kill();
    }, 30_000);
    const done = new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
      child.once("close", (status, signal) => {
        clearTimeout(deadline);
        resolve({ status, signal, stdout, stderr });
      });
    });
    children.add({ kill, done });
    return { child, done, errors };
  }

  async function run(command: string, args: string[], cwd = workspace) {
    const running = start(command, args, cwd);
    running.child.stdin.end();
    const result = await running.done;
    expect(running.errors, result.stderr).toEqual([]);
    expect(result.signal, result.stderr).toBeNull();
    return result;
  }

  async function rpc(
    args: string[] = ["--no-session"],
    cwd = workspace,
    entry = cliPath,
    options: { model?: { provider: string; id: string }; allowGeneration?: boolean } = {},
  ) {
    const selectedArgs = options.model
      ? ["--provider", options.model.provider, "--model", options.model.id]
      : modelArgs;
    const running = start(process.execPath, [entry, "--mode", "rpc", ...selectedArgs, ...args], cwd);
    const events: Record<string, unknown>[] = [];
    const pending = new Map<string, {
      resolve: (data: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }>();
    const waiting = new Map<(record: Record<string, unknown>, index: number) => void, (error: Error) => void>();
    let sequence = 0;
    let exited = false;
    let failure: Error | undefined;
    let buffer = "";
    function fail(error: Error) {
      failure ??= error;
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      for (const reject of waiting.values()) reject(error);
    }
    function receive(line: string) {
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        events.push(record);
        if (record.type === "response") {
          const waiter = pending.get(String(record.id));
          pending.delete(String(record.id));
          if (record.success === true) waiter?.resolve((record.data ?? {}) as Record<string, unknown>);
          else waiter?.reject(new Error(String(record.error)));
        }
        if (record.type === "extension_error" ||
          (record.type === "extension_ui_request" && record.notifyType === "error") ||
          (record.type === "agent_start" && !options.allowGeneration)) {
          running.errors.push(line);
          fail(new Error(line));
        }
        if (record.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(String(record.method))) {
          running.errors.push(`Unexpected interactive request: ${line}`);
          running.child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: record.id, cancelled: true })}\n`);
          fail(new Error(`Unexpected interactive request: ${line}`));
        }
        for (const accept of waiting.keys()) accept(record, events.length - 1);
      } catch (error) {
        running.errors.push(`Invalid RPC output: ${line}: ${String(error)}`);
        fail(new Error(running.errors.at(-1)));
      }
    }
    // RPC records split on LF only, including when JSON text contains Unicode separators.
    running.child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, boundary).replace(/\r$/, "");
        buffer = buffer.slice(boundary + 1);
        receive(line);
      }
    });
    void running.done.then((result) => {
      exited = true;
      if (buffer) running.errors.push(`Incomplete RPC record: ${buffer}`);
      fail(new Error(`CLI exited before RPC completion: ${result.stderr}\n${running.errors.join("\n")}`));
    });
    function waitFor(
      type: string,
      after = events.length,
      matches: (record: Record<string, unknown>) => boolean = () => true,
    ) {
      if (failure) return Promise.reject(failure);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        function finish(error?: Error, record?: Record<string, unknown>) {
          clearTimeout(deadline);
          waiting.delete(accept);
          if (error) reject(error);
          else resolve(record!);
        }
        function accept(record: Record<string, unknown>, index: number) {
          try {
            if (index >= after && record.type === type && matches(record)) finish(undefined, record);
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
        const deadline = setTimeout(() => {
          finish(new Error(`Timed out waiting for ${type}: ${JSON.stringify(events.slice(-5))}`));
        }, 15_000);
        waiting.set(accept, (error) => finish(error));
        for (let index = after; index < events.length && waiting.has(accept); index++) accept(events[index]!, index);
      });
    }
    function request(type: string, fields: Record<string, unknown> = {}) {
      if (failure) return Promise.reject(failure);
      if (exited) return Promise.reject(new Error("CLI already exited"));
      const id = String(++sequence);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        running.child.stdin.write(`${JSON.stringify({ ...fields, type, id })}\n`);
      });
    }
    const state = await request("get_state");
    expect(state).toMatchObject({ model: options.model ?? { provider: "openai", id: "gpt-4o-mini" }, isStreaming: false });
    expect(events).toContainEqual(expect.objectContaining({
      type: "extension_ui_request", method: "setStatus", statusKey: "agent", statusText: expect.stringContaining("agent: general"),
    }));
    expect(running.errors).toEqual([]);
    return {
      state,
      events,
      request,
      waitFor,
      async promptAndWait(message: string) {
        const after = events.length;
        await Promise.all([waitFor("agent_settled", after), request("prompt", { message })]);
        const turn = events.slice(after);
        for (const record of turn) {
          const message = record.message as { stopReason?: string; errorMessage?: string } | undefined;
          if (record.type === "message_end" && message?.stopReason === "error") {
            throw new Error(message.errorMessage ?? "Provider failed");
          }
        }
        return turn;
      },
      async close() {
        running.child.stdin.end();
        const result = await running.done;
        expect(running.errors, result.stderr).toEqual([]);
        expect(result.stderr).not.toMatch(/Failed to load extension|Error loading extension/i);
        expect(result.signal, result.stderr).toBeNull();
        expect(result.status, result.stderr).toBe(0);
      },
    };
  }

  // A denied namespace must fail, never silently run online or skip coverage.
  const sandbox = await run(process.execPath, ["--version"]);
  expect(sandbox.status, `Network isolation unavailable: ${sandbox.stderr}`).toBe(0);
  return { root, home, workspace, run, rpc };
}
