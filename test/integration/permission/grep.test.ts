import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import grep from "../../../src/optimizer/reducer/grep.js";
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
  workspace = await createWorkspace({ prefix: "surgent-permission-grep-" });
  vi.stubEnv("TMPDIR", join(workspace.root, "tmp"));
  executeGrep.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function search(
  lines: string[],
  path: string,
  pi: ReturnType<typeof makePermissionSession>,
  ctx: ReturnType<typeof makePermissionContext>,
) {
  executeGrep.mockResolvedValue({ content: [{ type: "text", text: lines.join("\n") }], details: undefined });
  grep(pi.api);
  const result = await pi.tool("grep").execute("search", { pattern: "match", path }, undefined, undefined, ctx);
  return result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
}

describe("grep result permissions", () => {
  it.each(["policy", "piignore"])("omits headers and content blocked by %s while keeping allowed matches", async (source) => {
    await writeFile(join(workspace.cwd, "public.txt"), "public match");
    await writeFile(join(workspace.cwd, "private.txt"), "fake private match");
    await writeRules({ project: { file: {
      "private.txt": source === "policy" ? "deny" : "read",
    } } }, workspace.cwd);
    if (source === "piignore") await writeFile(join(workspace.cwd, ".piignore"), "private.txt\n");
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd);

    const text = await search([
      "private.txt:1: fake private match", "private.txt-2- fake private context", "",
      "public.txt:1: public match",
    ], ".", pi, ctx);

    expect(text.split("\n")).not.toContain("private.txt");
    expect(text).not.toContain("fake private");
    expect(text).toContain("public.txt\n1: public match");
    expect(text).toContain("Search results exclude files blocked by permission rules");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it.each(["assistant", "restricted", "yolo"] as const)("enforces agent read scope inside the project despite stored grants in %s mode", async (mode) => {
    await writeRules({ project: { file: { "private.txt": "read" } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": ["public.txt"] }, mode);
    const ctx = makePermissionContext(workspace.cwd);

    const text = await search([
      "private.txt:1: fake private match", "public.txt:1: public match",
    ], ".", pi, ctx);

    expect(text).not.toContain("fake private match");
    expect(text).toContain("public.txt\n1: public match");
    expect(text).toContain("agent files.read scope");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it.each(["policy", "agent", "agent-grant"])("omits outside-root files denied by %s without asking to approve them", async (source) => {
    await mkdir(join(workspace.root, "outside"));
    if (source !== "agent") await writeRules({ project: { file: {
      "../outside/private.txt": source === "policy" ? "deny" : "read",
    } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": source !== "policy" ? ["public.txt"] : undefined });
    const ctx = makePermissionContext(workspace.cwd);

    const text = await search(["private.txt:1: fake private match"], "../outside", pi, ctx);

    expect(text).not.toContain("fake private match");
    expect(text).toContain(source === "policy" ? "../outside/private.txt" : "agent files.read scope");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("approves mixed outside-root results without exposing denied content", async () => {
    await mkdir(join(workspace.root, "outside"));
    await writeRules({ project: { file: {
      "../outside/allowed.txt": "read", "../outside/denied.txt": "deny",
    } } }, workspace.cwd);
    const pi = makePermissionSession();
    const ctx = makePermissionContext(workspace.cwd, true);
    ctx.ui.custom.mockResolvedValue({ allowed: true });

    const text = await search([
      "denied.txt:1: fake private match", "allowed.txt:1: allowed match",
      "first.txt:1: first match", "second.txt:1: second match",
    ], "../outside", pi, ctx);

    expect(text).not.toContain("fake private match");
    expect(text).toContain("allowed.txt\n1: allowed match");
    expect(text).toContain("first.txt\n1: first match");
    expect(text).toContain("second.txt\n1: second match");
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  it.each(["policy", "piignore", "agent"])("checks physical symlink targets against %s instead of trusting the alias", async (source) => {
    await mkdir(join(workspace.cwd, "private"));
    await writeFile(join(workspace.cwd, "private", "target.txt"), "fake private match");
    await symlink(join(workspace.cwd, "private", "target.txt"), join(workspace.cwd, "public.txt"));
    await writeRules({ project: { file: {
      "public.txt": "read", "private/target.txt": source === "policy" ? "deny" : "read",
    } } }, workspace.cwd);
    if (source === "piignore") await writeFile(join(workspace.cwd, ".piignore"), "private/\n");
    const pi = makePermissionSession({ description: "test", "files.read": source === "agent" ? ["public.txt"] : undefined });
    const ctx = makePermissionContext(workspace.cwd);

    const text = await search(["public.txt:1: fake private match"], "public.txt", pi, ctx);

    expect(text.split("\n")).not.toContain("public.txt");
    expect(text).not.toContain("fake private match");
    expect(text).toContain("Search results exclude files blocked by permission rules");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("allows an outside alias whose physical target is inside the agent read scope", async () => {
    await writeFile(join(workspace.cwd, "public.txt"), "public match");
    await symlink(join(workspace.cwd, "public.txt"), join(workspace.root, "alias.txt"));
    await writeRules({ project: { file: { "../alias.txt": "deny" } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": ["public.txt"] });
    const ctx = makePermissionContext(workspace.cwd);

    expect(await search(["alias.txt:1: public match"], "../alias.txt", pi, ctx)).toBe("alias.txt\n1: public match");
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it.each(["dangling", "loop"])("rejects directory results with a %s symlink instead of trusting its name", async (kind) => {
    await symlink(join(workspace.cwd, kind === "loop" ? "link.txt" : "missing.txt"), join(workspace.cwd, "link.txt"));
    const pi = makePermissionSession();

    await expect(search(["link.txt:1: fake private match"], ".", pi, makePermissionContext(workspace.cwd))).rejects.toThrow();
  });

  it("rejects results when stored permissions cannot be parsed", async () => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), "not-json");
    const pi = makePermissionSession();

    await expect(search(["private.txt:1: fake private match"], ".", pi, makePermissionContext(workspace.cwd)))
      .rejects.toThrow(SyntaxError);
  });

  it("rejects content without a file header rather than returning unchecked matches", async () => {
    const pi = makePermissionSession();

    await expect(search(["1: fake private match"], ".", pi, makePermissionContext(workspace.cwd)))
      .rejects.toThrow("Cannot authorize grep content without a file");
  });
});
