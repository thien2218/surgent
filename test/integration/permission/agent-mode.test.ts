import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMeta } from "../../../src/agent/types.js";
import type { PermissionRule } from "../../../src/permission/types.js";
import { enforceToolPermission } from "../../../src/permission/index.js";
import { getPermissionCheck } from "../../../src/permission/helpers.js";
import { resolvePermission } from "../../../src/permission/resolution.js";
import { readAgentMode, writeAgentMode } from "../../../src/permission/storage.js";

let root: string;
let home: string;
let cwd: string;
let oldHome: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "surgent-mode-"));
  home = join(root, "home");
  cwd = join(root, "work");
  oldHome = process.env.HOME;
  process.env.HOME = home;
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
});

afterEach(async () => {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("agent mode storage", () => {
  it("falls back to assistant when stored mode is missing or invalid", async () => {
    expect(await readAgentMode()).toBe("assistant");

    await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "root" } }));

    expect(await readAgentMode()).toBe("assistant");
  });

  it("writes mode without removing existing agent settings", async () => {
    await writeFile(
      join(home, ".pi", "agent", "settings.json"),
      JSON.stringify({ agent: { meta: { main: { model: "fake/model" } } }, other: true }),
    );

    await writeAgentMode("restricted");

    await expect(readJson(join(home, ".pi", "agent", "settings.json"))).resolves.toEqual({
      agent: { mode: "restricted", meta: { main: { model: "fake/model" } } },
      other: true,
    });
  });
});

describe("agent mode permission behavior", () => {
  it("lets yolo proceed for unresolved permissions but not explicit denies", async () => {
    const meta: AgentMeta = { description: "test" };
    const unresolved = await enforceToolPermission(
      fakePi(),
      { toolName: "web_fetch", input: { url: "https://example.com" } } as never,
      fakeContext(false),
      meta,
      "session-1",
      "yolo",
    );

    await writeGlobalRules({ web: { "https://blocked.example": false } });
    const denied = await enforceToolPermission(
      fakePi(),
      { toolName: "web_fetch", input: { url: "https://blocked.example" } } as never,
      fakeContext(false),
      meta,
      "session-1",
      "yolo",
    );

    expect(unresolved).toBeUndefined();
    expect(denied).toEqual({ block: true, reason: "Access to this resource is denied" });
  });

  it("keeps agent profile allowlists enforced in yolo mode", async () => {
    const result = await enforceToolPermission(
      fakePi(),
      { toolName: "read", input: { path: join(cwd, "secret.txt") } } as never,
      fakeContext(false),
      { description: "test", "files.read": ["allowed/**"] },
      "session-1",
      "yolo",
    );

    expect(result).toEqual({ block: true, reason: "Access to this resource is beyond allowed scope" });
  });

  it("blocks non-interactive unresolved permissions outside yolo", async () => {
    const meta: AgentMeta = { description: "test" };
    const assistant = await enforceToolPermission(
      fakePi(),
      { toolName: "web_fetch", input: { url: "https://example.com" } } as never,
      fakeContext(false),
      meta,
      "session-1",
      "assistant",
    );
    const restricted = await enforceToolPermission(
      fakePi(),
      { toolName: "web_fetch", input: { url: "https://example.com" } } as never,
      fakeContext(false),
      meta,
      "session-1",
      "restricted",
    );

    expect(assistant).toEqual({ block: true, reason: "Permission request requires interactive UI" });
    expect(restricted).toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });

  it("ignores global allows but keeps global denies in restricted mode", async () => {
    await writeGlobalRules({
      web: {
        "https://allowed.example": true,
        "https://denied.example": false,
      },
    });

    const allowedByGlobal = await resolvePermission(
      cwd,
      await permissionCheck("web_fetch", "https://allowed.example"),
      "restricted",
    );
    const deniedByGlobal = await resolvePermission(
      cwd,
      await permissionCheck("web_fetch", "https://denied.example"),
      "restricted",
    );

    expect(allowedByGlobal).toBe("ask");
    expect(deniedByGlobal).toBe("deny");
  });

  it("requires explicit permission for restricted writes that assistant auto-allows inside cwd", async () => {
    const target = "src/file.ts";

    const assistant = await resolvePermission(
      cwd,
      await permissionCheck("write", target),
      "assistant",
    );
    const restricted = await resolvePermission(
      cwd,
      await permissionCheck("write", target),
      "restricted",
    );
    const restrictedRead = await resolvePermission(
      cwd,
      await permissionCheck("read", target),
      "restricted",
    );

    expect(assistant).toBe("allowed");
    expect(restricted).toBe("ask");
    expect(restrictedRead).toBe("allowed");
  });
});

async function writeGlobalRules(rule: PermissionRule) {
  await writeFile(join(home, ".pi", "agent", "permissions.json"), JSON.stringify(rule));
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function permissionCheck(toolName: "read" | "write" | "web_fetch", raw: string) {
  const check = await getPermissionCheck(cwd, "session-1", toolName, toolName === "web_fetch" ? { url: raw } : { path: raw });
  if (!check) throw new Error("Missing permission check");
  return check;
}

function fakePi() {
  return { sendUserMessage: vi.fn() } as never;
}

function fakeContext(hasUI: boolean) {
  return {
    cwd,
    hasUI,
    ui: { custom: vi.fn(), notify: vi.fn() },
    sessionManager: { getSessionId: () => "session-1" },
  } as never;
}
