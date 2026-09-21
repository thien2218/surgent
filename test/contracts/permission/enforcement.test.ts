import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceToolPermission } from "../../../src/permission/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import { getPiPath } from "../../../src/utils.js";
import { createPermissionSandbox } from "../../helpers/permission.js";
import { testTheme } from "../../helpers/tui.js";

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
});

function createHarness(promptResult?: unknown, hasUI = true) {
  const custom = vi.fn(async () => {
    if (promptResult instanceof Error) throw promptResult;
    return promptResult;
  });
  const sendUserMessage = vi.fn();
  const pi = { sendUserMessage } as unknown as ExtensionAPI;
  const ctx = {
    cwd: sandbox.cwd,
    hasUI,
    ui: { custom, theme: testTheme },
  } as unknown as ExtensionContext;
  return { pi, ctx, custom, sendUserMessage };
}

describe("permission enforcement", () => {
  it("applies .piignore before agent and stored rules", async () => {
    await writeFile(join(sandbox.cwd, ".piignore"), "secret.txt\n", "utf8");
    await writeRules({ project: { file: { "secret.txt": "read" } } }, sandbox.cwd);
    const harness = createHarness();

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "read", input: { path: "secret.txt" } },
      harness.ctx,
      { description: "Test agent", "files.read": [] },
      "session-1",
      "assistant",
    );

    expect(result).toEqual({ block: true, reason: 'Path blocked by .piignore rule "secret.txt"' });
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("applies agent restrictions before stored grants", async () => {
    await writeRules({ project: { file: { "secret.txt": "read" } } }, sandbox.cwd);
    const harness = createHarness();

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "read", input: { path: "secret.txt" } },
      harness.ctx,
      { description: "Test agent", "files.read": ["public/**"] },
      "session-1",
      "assistant",
    );

    expect(result).toEqual({
      block: true,
      reason: "Access to this resource is beyond allowed scope",
    });
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("applies stored decisions before mode and prompting", async () => {
    await writeRules({ project: { web: { "https://blocked.test/**": false } } }, sandbox.cwd);
    const harness = createHarness();

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://blocked.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "yolo",
    );

    expect(result).toEqual({ block: true, reason: "Access to this resource is denied" });
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("keeps .piignore and agent denials enforced in YOLO mode", async () => {
    await writeFile(join(sandbox.cwd, ".piignore"), "ignored.txt\n", "utf8");
    const harness = createHarness();

    await expect(
      enforceToolPermission(
        harness.pi,
        { type: "tool_call", toolCallId: "permission-test", toolName: "read", input: { path: "ignored.txt" } },
        harness.ctx,
        { description: "Test agent" },
        "session-1",
        "yolo",
      ),
    ).resolves.toMatchObject({ block: true });
    await expect(
      enforceToolPermission(
        harness.pi,
        { type: "tool_call", toolCallId: "permission-test", toolName: "read", input: { path: "private.txt" } },
        harness.ctx,
        { description: "Test agent", "files.read": ["public/**"] },
        "session-1",
        "yolo",
      ),
    ).resolves.toMatchObject({ block: true });
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("lets YOLO bypass only unresolved prompts", async () => {
    const harness = createHarness();

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "yolo",
    );

    expect(result).toBeUndefined();
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("does not prompt for an explicit stored allowance", async () => {
    await writeRules({ project: { web: { "https://allowed.test/**": true } } }, sandbox.cwd);
    const harness = createHarness();

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://allowed.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "assistant",
    );

    expect(result).toBeUndefined();
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it("blocks unresolved requests without interactive UI", async () => {
    const harness = createHarness(undefined, false);

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "assistant",
    );

    expect(result).toEqual({
      block: true,
      reason: "Permission request requires interactive UI",
    });
    expect(harness.custom).not.toHaveBeenCalled();
  });

  it.each([
    [{ allowed: true }, undefined],
    [{ allowed: false }, "User rejected this tool call"],
    [undefined, "Permission request was cancelled"],
    [new Error("prompt failed"), "Permission check failed"],
  ])("handles prompt decisions and failures", async (promptResult, reason) => {
    const harness = createHarness(promptResult);

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "assistant",
    );

    if (reason) expect(result).toMatchObject({ block: true, reason: expect.stringContaining(reason) });
    else expect(result).toBeUndefined();
  });

  it("steers on an allowed amendment", async () => {
    const harness = createHarness({ allowed: true, amended: "Use public endpoint" });

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "assistant",
    );

    expect(result).toBeUndefined();
    expect(harness.sendUserMessage).toHaveBeenCalledWith("Use public endpoint", {
      deliverAs: "steer",
    });
  });

  it("includes denied amendment in the block reason", async () => {
    const harness = createHarness({ allowed: false, amended: "Use cached data" });

    const result = await enforceToolPermission(
      harness.pi,
      { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
      harness.ctx,
      { description: "Test agent" },
      "session-1",
      "assistant",
    );

    expect(result).toMatchObject({
      block: true,
      reason: expect.stringContaining("User input: Use cached data"),
    });
  });

  it("fails closed on malformed stored or ignore rules in YOLO mode", async () => {
    const harness = createHarness();
    await writeFile(getPiPath("permissions", sandbox.cwd), "{", "utf8");

    await expect(
      enforceToolPermission(
        harness.pi,
        { type: "tool_call", toolCallId: "permission-test", toolName: "web_fetch", input: { url: "https://unknown.test/data" } },
        harness.ctx,
        { description: "Test agent" },
        "session-1",
        "yolo",
      ),
    ).resolves.toEqual({ block: true, reason: "Permission check failed" });

    await writeRules({}, sandbox.cwd);
    await writeFile(join(sandbox.cwd, ".piignore"), "!\n", "utf8");
    await expect(
      enforceToolPermission(
        harness.pi,
        { type: "tool_call", toolCallId: "permission-test", toolName: "read", input: { path: "src/index.ts" } },
        harness.ctx,
        { description: "Test agent" },
        "session-1",
        "yolo",
      ),
    ).resolves.toEqual({ block: true, reason: "Permission check failed" });
  });
});
