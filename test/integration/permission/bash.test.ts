import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { enforceToolPermission } from "../../../src/permission/index.js";
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
    const custom = vi.fn().mockResolvedValue({ allowed });

    const result = await enforceToolPermission(
      { sendUserMessage: vi.fn() } as never,
      { toolName: "bash", input: { command, purpose: "test" } } as never,
      {
        cwd: workspace.cwd,
        hasUI: true,
        ui: { custom, notify: vi.fn() },
      } as never,
      { description: "test" },
      "session-1",
      "assistant",
    );

    expect(custom).toHaveBeenCalledTimes(1);
    if (blocked) {
      expect(result).toEqual({ block: true, reason: expect.stringContaining("User rejected this tool call") });
    } else {
      expect(result).toBeUndefined();
    }
  });
});
