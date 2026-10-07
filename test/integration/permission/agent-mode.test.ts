import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";
import type { PermissionRule } from "../../../src/permission/types.js";
import { getPermissionCheck } from "../../../src/permission/helpers.js";
import { resolvePermission } from "../../../src/permission/resolution.js";
import { readAgentMode, writeAgentMode } from "../../../src/permission/storage.js";

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-mode-" });
});

describe("agent mode storage", () => {
  it("falls back to assistant when stored mode is missing or invalid", async () => {
    expect(await readAgentMode()).toBe("assistant");

    await writeFile(join(workspace.home, ".pi", "agent", "settings.json"), JSON.stringify({ agent: { mode: "root" } }));

    expect(await readAgentMode()).toBe("assistant");
  });

  it("writes mode without removing existing agent settings", async () => {
    await writeFile(
      join(workspace.home, ".pi", "agent", "settings.json"),
      JSON.stringify({ agent: { meta: { main: { model: "fake/model" } } }, other: true }),
    );

    await writeAgentMode("restricted");

    await expect(readJson(join(workspace.home, ".pi", "agent", "settings.json"))).resolves.toEqual({
      agent: { mode: "restricted", meta: { main: { model: "fake/model" } } },
      other: true,
    });
  });
});

describe("agent mode permission behavior", () => {
  it("ignores global allows but keeps global denies in restricted mode", async () => {
    await writeGlobalRules({
      web: {
        "https://allowed.example": true,
        "https://denied.example": false,
      },
    });

    const allowedByGlobal = await resolvePermission(
      workspace.cwd,
      await permissionCheck("web_fetch", "https://allowed.example"),
      "restricted",
    );
    const deniedByGlobal = await resolvePermission(
      workspace.cwd,
      await permissionCheck("web_fetch", "https://denied.example"),
      "restricted",
    );

    expect(allowedByGlobal).toBe("ask");
    expect(deniedByGlobal).toBe("https://denied.example");
  });

  it("requires explicit permission for restricted writes that assistant auto-allows inside cwd", async () => {
    const target = "src/file.ts";

    const assistant = await resolvePermission(
      workspace.cwd,
      await permissionCheck("write", target),
      "assistant",
    );
    const restricted = await resolvePermission(
      workspace.cwd,
      await permissionCheck("write", target),
      "restricted",
    );
    const restrictedRead = await resolvePermission(
      workspace.cwd,
      await permissionCheck("read", target),
      "restricted",
    );

    expect(assistant).toBe("allowed");
    expect(restricted).toBe("ask");
    expect(restrictedRead).toBe("allowed");
  });
});

async function writeGlobalRules(rule: PermissionRule) {
  await writeFile(join(workspace.home, ".pi", "agent", "permissions.json"), JSON.stringify(rule));
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function permissionCheck(toolName: "read" | "write" | "web_fetch", raw: string) {
  const check = await getPermissionCheck(workspace.cwd, "session-1", toolName, toolName === "web_fetch" ? { url: raw } : { path: raw });
  if (!check) throw new Error("Missing permission check");
  return check;
}

