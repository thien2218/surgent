import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePermissionContext, makePermissionSession, makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import permissionExtension from "../../../src/permission/index.js";
import { writeRules } from "../../../src/permission/storage.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-bash-permission-");
});

afterEach(async () => {
  await workspace.restore();
});

describe("persisted bash permissions", () => {
  it.each([
    { allowed: true, blocked: false },
    { allowed: false, blocked: true },
  ])("requires a fresh decision despite an allow rule: $allowed", async ({ allowed, blocked }) => {
    const command = "bash -c 'echo ok'";
    await writeRules({ bash: { [command]: true } });
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue({ allowed });
    permissionExtension(pi.api);

    const result = await pi.event("tool_call")(
      { type: "tool_call", toolCallId: "uncertain", toolName: "bash", input: { command, purpose: "test" } },
      ctx,
    );

    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    if (blocked) {
      expect(result).toEqual({ block: true, reason: expect.stringContaining("User rejected this tool call") });
    } else {
      expect(result).toBeUndefined();
    }
  });
});
