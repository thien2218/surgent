import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePiIgnorePathBlock } from "../../../src/permission/piignore.js";
import { createPermissionSandbox } from "../../helpers/permission.js";

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
});

function ignorePath() {
  return join(sandbox.cwd, ".piignore");
}

describe(".piignore integration", () => {
  it("uses negation and the most specific matching rule", async () => {
    await writeFile(
      ignorePath(),
      "secrets/**\n!secrets/public/**\nsecrets/public/private/**\n",
      "utf8",
    );

    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "secrets/token.txt")).resolves.toContain(
      "secrets/**",
    );
    await expect(
      resolvePiIgnorePathBlock(sandbox.cwd, "secrets/public/readme.txt"),
    ).resolves.toBeNull();
    await expect(
      resolvePiIgnorePathBlock(sandbox.cwd, "secrets/public/private/token.txt"),
    ).resolves.toContain("secrets/public/private/**");
  });

  it("uses the last rule when specificity is equal", async () => {
    await writeFile(ignorePath(), "build/**\n!build/**\n", "utf8");
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "build/output.js")).resolves.toBeNull();

    await writeFile(ignorePath(), "!build/**\nbuild/**\n", "utf8");
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "build/output.js")).resolves.toContain(
      "build/**",
    );
  });

  it("refreshes cached rules after changes, deletion, and recreation", async () => {
    await writeFile(ignorePath(), "one/**\n", "utf8");
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "one/file.txt")).resolves.toContain(
      "one/**",
    );

    await writeFile(ignorePath(), "two/**\n", "utf8");
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "one/file.txt")).resolves.toBeNull();
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "two/file.txt")).resolves.toContain(
      "two/**",
    );

    await unlink(ignorePath());
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "two/file.txt")).resolves.toBeNull();

    await writeFile(ignorePath(), "three/**\n", "utf8");
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "three/file.txt")).resolves.toContain(
      "three/**",
    );
  });

  it("does not apply rules to paths outside the project root", async () => {
    await writeFile(ignorePath(), "**\n", "utf8");

    await expect(
      resolvePiIgnorePathBlock(sandbox.cwd, join(sandbox.directory, "outside.txt")),
    ).resolves.toBeNull();
  });

  it("treats a missing file as no additional restriction", async () => {
    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "src/index.ts")).resolves.toBeNull();
  });

  it("rejects malformed rules", async () => {
    await writeFile(ignorePath(), "!\n", "utf8");

    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "src/index.ts")).rejects.toThrow(
      "Invalid .piignore rule",
    );
  });

  it("rejects unreadable .piignore paths", async () => {
    await mkdir(ignorePath());

    await expect(resolvePiIgnorePathBlock(sandbox.cwd, "src/index.ts")).rejects.toThrow();
  });
});
