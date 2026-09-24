import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { resolvePiIgnorePathBlock } from "../../../src/permission/piignore.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-piignore-", true);
});

afterEach(async () => {
  await workspace.restore();
});

describe("piignore files", () => {
  it("allows paths when neither ignore file exists", async () => {
    await expect(resolvePiIgnorePathBlock(workspace.cwd, "private/file.ts")).resolves.toBeNull();
  });

  it("normalizes slashes and directory patterns before applying exceptions", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "# private files\r\n\r\n/private//\r\n!/private/keep.txt\r\n");

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "private/keep.txt")).resolves.toBeNull();
    await expect(resolvePiIgnorePathBlock(workspace.cwd, "private/blocked.txt"))
      .resolves.toBe('Path blocked by .piignore rule "/private//"');
    await expect(resolvePiIgnorePathBlock(workspace.cwd, join(workspace.cwd, "private", "blocked.txt")))
      .resolves.toBe('Path blocked by .piignore rule "/private//"');
  });

  it("does not match relative ignore paths when process cwd is outside the supplied root", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "private/\n");
    process.chdir(workspace.home);

    // Characterizes the current cwd dependency; callers normally run in the project root.
    await expect(resolvePiIgnorePathBlock(workspace.cwd, "private/file.ts")).resolves.toBeNull();
  });

  it("applies global ignore rules when the project ignore file is absent", async () => {
    await writeFile(join(workspace.home, ".pi", "agent", ".piignore"), "private/\n");

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "private/file.ts"))
      .resolves.toBe('Path blocked by .piignore rule "private/"');
  });

  it.each(["!", "bad\0name"])("rejects invalid rule %j with its source line", async (rule) => {
    await writeFile(join(workspace.cwd, ".piignore"), `# comment\n\n${rule}\n`);

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "file.ts"))
      .rejects.toThrow("Invalid .piignore rule on line 3");
  });

  it("propagates ignore-file read errors rather than silently allowing paths", async () => {
    await mkdir(join(workspace.cwd, ".piignore"));

    await expect(resolvePiIgnorePathBlock(workspace.cwd, "file.ts"))
      .rejects.toMatchObject({ code: "EISDIR" });
  });
});
