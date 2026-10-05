import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

export interface Workspace {
  root: string;
  home: string;
  cwd: string;
  restore: () => Promise<void>;
}

export async function createWorkspace({
  prefix = "surgent-workspace-",
  changeCwd = false,
}: { prefix?: string; changeCwd?: boolean } = {}): Promise<Workspace> {
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const oldCwd = process.cwd();
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix));
  let disposal: Promise<void> | undefined;
  const restore = () => disposal ??= (async () => {
    try {
      if (changeCwd) process.chdir(oldCwd);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = oldProfile;
    }
    await rm(root, { recursive: true, force: true });
  })();

  try {
    onTestFinished(restore);
    const home = join(root, "home");
    const cwd = join(root, "work");
    await mkdir(join(home, ".pi", "agent"), { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    if (changeCwd) process.chdir(cwd);
    return { root, home, cwd, restore };
  } catch (error) {
    try {
      await restore();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Workspace setup and cleanup failed", { cause: error });
    }
    throw error;
  }
}
