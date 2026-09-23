import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePermission, resolvePermissionPath } from "../../../src/permission/resolution.js";
import { resolvePiIgnorePathBlock } from "../../../src/permission/piignore.js";
import { writeRules } from "../../../src/permission/storage.js";
import type { PermissionCheck } from "../../../src/permission/types.js";
import { extractOpAndPath } from "../../../src/permission/helpers.js";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;
beforeEach(async () => {
  workspace = await makePermissionWorkspace();
  await mkdir(join(workspace.cwd, "src"));
  await writeFile(join(workspace.cwd, "src", "blocked.ts"), "private");
});
afterEach(async () => { await workspace.restore(); });

async function fileCheck(input: string): Promise<PermissionCheck> {
  const [operation, path] = extractOpAndPath(input);
  const physical = await resolvePermissionPath(path, workspace.cwd);
  return {
    sessionId: "session-1",
    toolName: operation,
    category: "file",
    raw: path,
    unresolved: [`${operation}:${relative(workspace.cwd, physical) || "."}`],
    purpose: "test",
  };
}

describe("permission file identity", () => {
  it.each(["src/blocked.ts", "./src/blocked.ts", "src/../src/blocked.ts", "absolute"])(
    "denies equivalent spelling %s",
    async (spelling) => {
      await writeRules({ project: { file: { "src/blocked.ts": "deny" } } }, workspace.cwd);
      const path = spelling === "absolute" ? join(workspace.cwd, "src", "blocked.ts") : spelling;

      await expect(resolvePermission(workspace.cwd, await fileCheck(`read:${path}`), "assistant"))
        .resolves.toBe("deny");
    },
  );

  it.each(["./src/blocked.ts", "src/../src/blocked.ts", "absolute"])(
    "offers project-relative rules for unresolved input %s", async (spelling) => {
      const path = spelling === "absolute" ? join(workspace.cwd, "src", "blocked.ts") : spelling;
      const check = await fileCheck(`write:${path}`);

      await expect(resolvePermission(workspace.cwd, check, "restricted")).resolves.toBe("ask");
      expect(check.unresolved).toEqual(["write:src/blocked.ts"]);
    },
  );

  it.each(["alias", "target"])("uses only the target rule when %s is denied", async (denied) => {
    await symlink(join(workspace.cwd, "src", "blocked.ts"), join(workspace.cwd, "alias.ts"));
    await writeRules({ project: { file: {
      "alias.ts": denied === "alias" ? "deny" : "read",
      "src/blocked.ts": denied === "target" ? "deny" : "read",
    } } }, workspace.cwd);

    await expect(resolvePermission(workspace.cwd, await fileCheck("read:alias.ts"), "assistant"))
      .resolves.toBe(denied === "target" ? "deny" : "allowed");
  });

  it("offers target-relative rules when access through an alias needs approval", async () => {
    await symlink(join(workspace.cwd, "src", "blocked.ts"), join(workspace.cwd, "alias.ts"));
    const check = await fileCheck("write:alias.ts");

    await expect(resolvePermission(workspace.cwd, check, "restricted")).resolves.toBe("ask");
    expect(check.unresolved).toEqual(["write:src/blocked.ts"]);
  });

  it("auto-allows an outside alias whose target is inside the project", async () => {
    const path = join(workspace.root, "alias.ts");
    await symlink(join(workspace.cwd, "src", "blocked.ts"), path);

    await expect(resolvePermission(workspace.cwd, await fileCheck(`read:${path}`), "assistant"))
      .resolves.toBe("allowed");
  });

  it.each(["read:escape/existing.txt", "write:escape/new/nested.txt"])(
    "does not auto-allow an escaped physical target: %s", async (input) => {
      await mkdir(join(workspace.root, "outside"));
      await writeFile(join(workspace.root, "outside", "existing.txt"), "outside");
      await symlink(join(workspace.root, "outside"), join(workspace.cwd, "escape"));

      await expect(resolvePermission(workspace.cwd, await fileCheck(input), "assistant"))
        .resolves.toBe("ask");
    },
  );

  it("honors outside-root relative denies for symlink targets", async () => {
    await writeFile(join(workspace.root, "secret.ts"), "private");
    await symlink(join(workspace.root, "secret.ts"), join(workspace.cwd, "escape.ts"));
    await writeRules({ project: { file: { "../secret.ts": "deny", "escape.ts": "read" } } }, workspace.cwd);

    await expect(resolvePermission(workspace.cwd, await fileCheck("read:escape.ts"), "assistant"))
      .resolves.toBe("deny");
  });

  it.each(["dangling", "loop"])("rejects uncertain physical resolution for %s links", async (kind) => {
    await symlink(join(workspace.cwd, kind === "loop" ? "link" : "missing"), join(workspace.cwd, "link"));

    await expect(resolvePermissionPath("link/child", workspace.cwd)).rejects.toThrow();
  });

  it("rejects paths below non-directories rather than assuming a missing destination", async () => {
    await expect(resolvePermissionPath("src/blocked.ts/child", workspace.cwd))
      .rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("piignore physical targets", () => {
  it.each(["alias.ts", "external"])("blocks ignored targets reached through %s", async (spelling) => {
    await writeFile(join(workspace.cwd, ".piignore"), "src/\n!alias.ts\n");
    const path = spelling === "external" ? join(workspace.root, "external") : join(workspace.cwd, spelling);
    await symlink(join(workspace.cwd, "src", "blocked.ts"), path);

    await expect(resolvePiIgnorePathBlock(workspace.cwd, path))
      .resolves.toBe('Path blocked by .piignore rule "src/"');
  });

  it("blocks missing destinations beneath a linked ignored directory", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "src/\n");
    await symlink(join(workspace.cwd, "src"), join(workspace.cwd, "alias"));

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "alias/new/file.ts"))
      .resolves.toBe('Path blocked by .piignore rule "src/"');
  });

  it("ignores alias-only rules when the target has an exception", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "alias.ts\n!src/blocked.ts\n");
    await symlink(join(workspace.cwd, "src", "blocked.ts"), join(workspace.cwd, "alias.ts"));

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "alias.ts")).resolves.toBeNull();
  });
});
