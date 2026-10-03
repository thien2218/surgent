import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterGrepResult } from "../../../src/optimizer/compactor/grep.js";
import { writeRules } from "../../../src/permission/storage.js";
import { makePermissionContext, makePermissionSession, makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-permission-grep-");
  vi.stubEnv("TMPDIR", join(workspace.root, "tmp"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await workspace.restore();
});

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

    const result = await filterGrepResult([
      "private.txt", "1: fake private match", "2- fake private context", "",
      "public.txt", "1: public match",
    ], ".", pi.state, ctx);

    expect(result.text.split("\n")).not.toContain("private.txt");
    expect(result.text).not.toContain("fake private");
    expect(result.text).toContain("public.txt\n1: public match");
    expect(result.text).toContain("Search results exclude files blocked by permission rules");
    expect(result.check).toBeUndefined();
  });

  it.each(["assistant", "restricted", "yolo"] as const)("enforces agent read scope inside the project despite stored grants in %s mode", async (mode) => {
    await writeRules({ project: { file: { "private.txt": "read" } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": ["public.txt"] }, mode);

    const result = await filterGrepResult([
      "private.txt", "1: fake private match", "public.txt", "1: public match",
    ], ".", pi.state, makePermissionContext(workspace.cwd));

    expect(result.text).not.toContain("fake private match");
    expect(result.text).toContain("public.txt\n1: public match");
    expect(result.text).toContain("agent files.read scope");
    expect(result.check).toBeUndefined();
  });

  it.each(["policy", "agent", "agent-grant"])("omits outside-root files denied by %s without asking to approve them", async (source) => {
    await mkdir(join(workspace.root, "outside"));
    if (source !== "agent") await writeRules({ project: { file: {
      "../outside/private.txt": source === "policy" ? "deny" : "read",
    } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": source !== "policy" ? ["public.txt"] : undefined });

    const result = await filterGrepResult([
      "private.txt", "1: fake private match",
    ], "../outside", pi.state, makePermissionContext(workspace.cwd));

    expect(result.text).not.toContain("fake private match");
    expect(result.text).toContain(source === "policy" ? "../outside/private.txt" : "agent files.read scope");
    expect(result.check).toBeUndefined();
  });

  it("asks only for unresolved outside-root matches in mixed results", async () => {
    await mkdir(join(workspace.root, "outside"));
    await writeRules({ project: { file: {
      "../outside/allowed.txt": "read", "../outside/denied.txt": "deny",
    } } }, workspace.cwd);
    const pi = makePermissionSession();

    const result = await filterGrepResult([
      "denied.txt", "1: fake private match", "allowed.txt", "1: allowed match",
      "first.txt", "1: first match", "second.txt", "1: second match",
    ], "../outside", pi.state, makePermissionContext(workspace.cwd));

    expect(result.text).not.toContain("fake private match");
    expect(result.text).toContain("allowed.txt\n1: allowed match");
    expect(result.text).toContain("first.txt\n1: first match");
    expect(result.text).toContain("second.txt\n1: second match");
    expect(result.check?.raw.trim().split("\n")).toEqual([
      join(workspace.root, "outside", "first.txt"), join(workspace.root, "outside", "second.txt"),
    ]);
    expect(result.check).toMatchObject({ category: "file", operation: "read", relative: "../outside/first.txt" });
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

    const result = await filterGrepResult([
      "public.txt", "1: fake private match",
    ], "public.txt", pi.state, makePermissionContext(workspace.cwd));

    expect(result.text.split("\n")).not.toContain("public.txt");
    expect(result.text).not.toContain("fake private match");
    expect(result.text).toContain("Search results exclude files blocked by permission rules");
    expect(result.check).toBeUndefined();
  });

  it("allows an outside alias whose physical target is inside the agent read scope", async () => {
    await writeFile(join(workspace.cwd, "public.txt"), "public match");
    await symlink(join(workspace.cwd, "public.txt"), join(workspace.root, "alias.txt"));
    await writeRules({ project: { file: { "../alias.txt": "deny" } } }, workspace.cwd);
    const pi = makePermissionSession({ description: "test", "files.read": ["public.txt"] });

    const result = await filterGrepResult([
      "alias.txt", "1: public match",
    ], "../alias.txt", pi.state, makePermissionContext(workspace.cwd));

    expect(result).toEqual({ text: "alias.txt\n1: public match", check: undefined });
  });

  it.each(["dangling", "loop"])("rejects directory results with a %s symlink instead of trusting its name", async (kind) => {
    await symlink(join(workspace.cwd, kind === "loop" ? "link.txt" : "missing.txt"), join(workspace.cwd, "link.txt"));
    const pi = makePermissionSession();

    await expect(filterGrepResult([
      "link.txt", "1: fake private match",
    ], ".", pi.state, makePermissionContext(workspace.cwd))).rejects.toThrow();
  });

  it("rejects results when stored permissions cannot be parsed", async () => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), "not-json");
    const pi = makePermissionSession();

    await expect(filterGrepResult(["private.txt", "1: fake private match"], ".", pi.state, makePermissionContext(workspace.cwd)))
      .rejects.toThrow(SyntaxError);
  });

  it("rejects content without a file header rather than returning unchecked matches", async () => {
    const pi = makePermissionSession();

    await expect(filterGrepResult(["1: fake private match"], ".", pi.state, makePermissionContext(workspace.cwd)))
      .rejects.toThrow("Cannot authorize grep content without a file");
  });
});
