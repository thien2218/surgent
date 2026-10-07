import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import permissionExtension from "../../../src/permission/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-inspect-permission-" });
  vi.stubEnv("TMPDIR", join(workspace.root, "tmp"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inspect read permissions", () => {
  it.each(["read", "inspect"])("allows %s with read scope, not write scope", async (toolName) => {
    const session = makePermissionSession({
      description: "test", "files.read": ["source.ts"], "files.write": ["other.ts"],
    });
    permissionExtension(session.api);

    const result = await session.event("tool_call")({
      type: "tool_call", toolCallId: "inspect-call", toolName,
      input: { path: "source.ts", symbol: "example" },
    }, makePermissionContext(workspace.cwd));

    expect(result).toBeUndefined();
  });

  it.each(["policy", "piignore", "agent"])("blocks inspect through symlink under %s denial even in yolo mode", async (source) => {
    await mkdir(join(workspace.cwd, "private"));
    await writeFile(join(workspace.cwd, "private", "source.ts"), "function example() {}\n");
    await symlink(join(workspace.cwd, "private", "source.ts"), join(workspace.cwd, "alias.ts"));
    await writeRules({ project: { file: {
      "alias.ts": "read", "private/source.ts": source === "policy" ? "deny" : "read",
    } } }, workspace.cwd);
    if (source === "piignore") await writeFile(join(workspace.cwd, ".piignore"), "private/\n");
    const session = makePermissionSession({
      description: "test", "files.read": source === "agent" ? ["alias.ts"] : undefined,
    }, "yolo");
    const ctx = makePermissionContext(workspace.cwd, true);
    permissionExtension(session.api);

    const result = await session.event("tool_call")({
      type: "tool_call", toolCallId: "inspect-call", toolName: "inspect",
      input: { path: "alias.ts", symbol: "example" },
    }, ctx);

    expect(result).toMatchObject({ block: true });
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it.each([
    { hasUI: false, approved: undefined, blocked: true },
    { hasUI: true, approved: undefined, blocked: true },
    { hasUI: true, approved: { allowed: false }, blocked: true },
    { hasUI: true, approved: { allowed: true }, blocked: false },
  ])("requires outside-root approval: %j", async ({ hasUI, approved, blocked }) => {
    const session = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd, hasUI);
    ctx.ui.custom.mockResolvedValue(approved);
    permissionExtension(session.api);

    const result = await session.event("tool_call")({
      type: "tool_call", toolCallId: "inspect-call", toolName: "inspect",
      input: { path: "../outside.ts", symbol: "example" },
    }, ctx);

    if (blocked) expect(result).toMatchObject({ block: true });
    else expect(result).toBeUndefined();
    expect(ctx.ui.custom).toHaveBeenCalledTimes(hasUI ? 1 : 0);
  });

  it("fails closed when permission storage is malformed", async () => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), "not-json");
    const session = makePermissionSession();
    permissionExtension(session.api);

    const result = await session.event("tool_call")({
      type: "tool_call", toolCallId: "inspect-call", toolName: "inspect",
      input: { path: "source.ts", symbol: "example" },
    }, makePermissionContext(workspace.cwd));

    expect(result).toEqual({ block: true, reason: expect.stringMatching(/JSON/) });
  });
});
