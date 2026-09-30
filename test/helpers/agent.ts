import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, vi } from "vitest";

export async function agentWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "surgent-agent-"));
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  const home = join(root, "home");
  const cwd = join(root, "project");
  const local = join(cwd, ".pi", "agents");
  const global = join(home, ".pi", "agent", "agents");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  await mkdir(local, { recursive: true });
  await mkdir(global, { recursive: true });
  return { cwd, local, global };
}
