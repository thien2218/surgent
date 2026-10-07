import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reducerExtension from "../../../src/optimizer/reducer/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

const { executeGrep } = vi.hoisted(() => ({ executeGrep: vi.fn() }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createGrepToolDefinition: (...args: Parameters<typeof actual.createGrepToolDefinition>) => ({
      ...actual.createGrepToolDefinition(...args), execute: executeGrep,
    }),
  };
});

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-grep-contract-", changeCwd: true });
  vi.stubEnv("TMPDIR", join(workspace.root, "tmp"));
  await mkdir(join(workspace.root, "outside"));
  await writeFile(join(workspace.root, "outside", "private.txt"), "fake outside match");
  executeGrep.mockReset();
  executeGrep.mockResolvedValue({
    content: [{ type: "text", text: "private.txt:1: fake outside match" }],
    details: undefined,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("grep outside-root approval", () => {
  it.each(["direct", "symlink"])("withholds %s results until the user approves", async (spelling) => {
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd, true);
    const prompted = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<{ allowed: boolean }>();
    ctx.ui.custom.mockImplementation(() => {
      prompted.resolve();
      return decision.promise;
    });
    let path = "../outside";
    if (spelling === "symlink") {
      await symlink(join(workspace.root, "outside", "private.txt"), join(workspace.cwd, "alias.txt"));
      path = "alias.txt";
      executeGrep.mockResolvedValue({ content: [{ type: "text", text: "alias.txt:1: fake outside match" }], details: undefined });
    }
    reducerExtension(pi.api);
    let settled = false;

    const pending = pi.tool("grep").execute("grep-call", { pattern: "match", path }, undefined, undefined, ctx)
      .then((result) => { settled = true; return result; });
    try {
      await Promise.race([
        prompted.promise,
        pending.then(() => { throw new Error("Grep returned before approval"); }),
      ]);
      expect(settled).toBe(false);
    } finally {
      decision.resolve({ allowed: true });
    }
    const result = await pending;

    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("1: fake outside match") }]);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it.each([
    { outcome: "deny", error: "User rejected this tool call" },
    { outcome: "cancel", error: "Permission request was cancelled" },
    { outcome: "headless", error: "Permission request requires interactive UI" },
    { outcome: "ui-error", error: "UI unavailable" },
  ])("never returns outside-root content on $outcome", async ({ outcome, error }) => {
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd, outcome !== "headless");
    if (outcome === "ui-error") ctx.ui.custom.mockRejectedValue(new Error("UI unavailable"));
    else ctx.ui.custom.mockResolvedValue(outcome === "deny" ? { allowed: false } : undefined);
    reducerExtension(pi.api);

    await expect(pi.tool("grep").execute("grep-call", { pattern: "match", path: "../outside" }, undefined, undefined, ctx))
      .rejects.toThrow(error);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(outcome === "headless" ? 0 : 1);
  });

  it.each(["stored-grant", "yolo"])("returns outside-root results without a prompt for %s", async (source) => {
    if (source === "stored-grant") await writeRules({ project: { file: { "../outside/private.txt": "read" } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test" }, source === "yolo" ? "yolo" : "assistant");
    const ctx = makePermissionContext(workspace.cwd);
    reducerExtension(pi.api);

    const result = await pi.tool("grep").execute("grep-call", { pattern: "match", path: "../outside" }, undefined, undefined, ctx);

    expect(result.content).toEqual([{ type: "text", text: "private.txt\n1: fake outside match" }]);
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("keeps denied content and raw details out of yolo results", async () => {
    await writeRules({ project: { file: { "../outside/private.txt": "deny" } } }, workspace.cwd);
    executeGrep.mockResolvedValue({
      content: [{ type: "text", text: "private.txt:1: fake outside match" }],
      details: { truncation: { content: "fake outside match" }, matchLimitReached: true },
    });
    const pi = makePermissionSession({ description: "test" }, "yolo");
    const ctx = makePermissionContext(workspace.cwd);
    reducerExtension(pi.api);

    const result = await pi.tool("grep").execute("grep-call", { pattern: "match", path: "../outside" }, undefined, undefined, ctx);

    expect(JSON.stringify(result)).not.toContain("fake outside match");
    expect(result.details).toEqual({ matchLimitReached: true, linesTruncated: undefined });
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });
});
