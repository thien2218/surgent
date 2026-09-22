import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PermissionWorkspace {
  root: string;
  home: string;
  cwd: string;
  restore: () => Promise<void>;
}

export async function makePermissionWorkspace(prefix = "surgent-permission-"): Promise<PermissionWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, "home");
  const cwd = join(root, "work");
  const oldHome = process.env.HOME;

  process.env.HOME = home;
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });

  return {
    root,
    home,
    cwd,
    restore: async () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      await rm(root, { recursive: true, force: true });
    },
  };
}
