import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import type { PermissionRule } from "../../../src/permission/types.js";
import permissionExtension from "../../../src/permission/index.js";
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
    const pi = makePermissionSession({ description: "test" }, "yolo");
    const ctx = makePermissionContext(cwd);
    permissionExtension(pi.api);

    const unresolved = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "unresolved", toolName: "web_fetch", input: { url: "https://example.com" } },
      ctx,
    );

    await writeGlobalRules({ web: { "https://blocked.example": false } });
    const denied = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "denied", toolName: "web_fetch", input: { url: "https://blocked.example" } },
      ctx,
    );

    expect(unresolved).toBeUndefined();
    expect(denied).toEqual({ block: true, reason: "Access to this resource is denied" });
  });

  it("keeps agent profile allowlists enforced in yolo mode", async () => {
    const pi = makePermissionSession({ description: "test", "files.read": ["allowed/**"] }, "yolo");
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "scope-denied", toolName: "read", input: { path: join(cwd, "secret.txt") } },
      makePermissionContext(cwd),
    );

    expect(result).toEqual({ block: true, reason: "Access to this resource is beyond allowed scope" });
  });

  it.each(["assistant", "restricted"] as const)("blocks non-interactive unresolved permissions in %s mode", async (mode) => {
    const pi = makePermissionSession({ description: "test" }, mode);
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "unresolved", toolName: "web_fetch", input: { url: "https://example.com" } },
      makePermissionContext(cwd),
    );

    expect(result).toEqual({ block: true, reason: "Permission request requires interactive UI" });
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

