import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspace } from "./workspace.js";

export async function agentWorkspace() {
  const workspace = await createWorkspace({ prefix: "surgent-agent-" });
  const cwd = join(workspace.root, "project");
  const local = join(cwd, ".pi", "agents");
  const global = join(workspace.home, ".pi", "agent", "agents");
  await mkdir(local, { recursive: true });
  await mkdir(global, { recursive: true });
  return { cwd, local, global };
}
