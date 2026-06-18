import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { InteractiveSubsessions, InteractiveMeta, RuntimeConfig } from "./types.js";

const STORE_FILE = getPiPath("subsessions", process.cwd());
const interactiveSubsessions: InteractiveSubsessions = {};
let isStoreLoaded = false;

async function loadStore() {
  if (isStoreLoaded) return;
  const persistedStore = await readJson<InteractiveSubsessions>(STORE_FILE, {});
  for (const [pid, subsessions] of Object.entries(persistedStore)) {
    interactiveSubsessions[pid] = subsessions;
  }
  isStoreLoaded = true;
}

export async function findSubsession(pid: string, id: string): Promise<InteractiveMeta | null> {
  await loadStore();
  const parentSubsessions = interactiveSubsessions[pid];
  if (!parentSubsessions) return null;
  return parentSubsessions[id] ?? null;
}

export async function saveSubsession(pid: string, id: string, entry: InteractiveMeta) {
  await loadStore();
  if (!interactiveSubsessions[pid]) {
    interactiveSubsessions[pid] = {};
  }
  interactiveSubsessions[pid]![id] = entry;
  await writeJson(STORE_FILE, interactiveSubsessions);
}

export async function deleteSubsession(pid: string, id: string) {
  await loadStore();

  const parentSubsessions = interactiveSubsessions[pid];
  if (!parentSubsessions || !parentSubsessions[id]) {
    return;
  }

  delete parentSubsessions[id];
  if (Object.keys(parentSubsessions).length === 0) {
    delete interactiveSubsessions[pid];
  }

  await writeJson(STORE_FILE, interactiveSubsessions);
}

export async function resolveRuntime(name: string, model?: string): Promise<RuntimeConfig> {
  const [agent] = await loadAgents(process.cwd(), name);
  return { systemPrompt: agent.body, tools: agent.meta.tools, modelId: agent.meta.model ?? model };
}
