import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { StoredSubsessions, SubsessionMeta, RuntimeConfig } from "./types.js";
import { unlink } from "node:fs/promises";

const STORE_FILE = getPiPath("subsessions", process.cwd());
const subsessions: StoredSubsessions = {};
let isStoreLoaded = false;

async function loadStore() {
  if (isStoreLoaded) return;
  const persistedStore = await readJson<StoredSubsessions>(STORE_FILE, {});
  for (const [id, sessions] of Object.entries(persistedStore)) {
    subsessions[id] = sessions;
  }
  isStoreLoaded = true;
}

export async function findSubsession(id: string, pid?: string): Promise<SubsessionMeta | null> {
  await loadStore();
  const found = subsessions[id];
  if (!found || (pid && found.pid !== pid)) return null;
  return found;
}

export async function saveSubsession(id: string, entry: SubsessionMeta) {
  await loadStore();
  subsessions[id] = entry;
  await writeJson(STORE_FILE, subsessions);
}

export async function terminateSubsession(cwd: string, id: string) {
  await loadStore();
  delete subsessions[id];
  await writeJson(STORE_FILE, subsessions);

  const sessions = await SessionManager.list(cwd, getPiPath("subsessionsDir"));
  const target = sessions.find((session) => session.id === id);
  if (!target) return;
  await unlink(target.path);
}

export async function resolveRuntime(name: string, model?: string): Promise<RuntimeConfig> {
  const [agent] = await loadAgents(process.cwd(), name);
  return { systemPrompt: agent.body, tools: agent.meta.tools, modelId: agent.meta.model ?? model };
}
