import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionCheck } from "../../src/permission/types.js";

export function createPermissionCheck(overrides: Partial<PermissionCheck> = {}): PermissionCheck {
  return {
    sessionId: "session-1",
    toolName: "read",
    category: "file",
    raw: "src/index.ts",
    unresolved: ["read:src/index.ts"],
    purpose: "Read source file",
    ...overrides,
  };
}

export async function createPermissionSandbox() {
  const directory = await mkdtemp(join(tmpdir(), "surgent-permission-"));
  const home = join(directory, "home");
  const cwd = join(directory, "project");
  const previousHome = process.env.HOME;

  await Promise.all([
    mkdir(join(home, ".pi", "agent"), { recursive: true }),
    mkdir(join(cwd, ".pi"), { recursive: true }),
  ]);
  process.env.HOME = home;

  return {
    directory,
    home,
    cwd,
    async cleanup() {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
