import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { InteractiveSubsessions, InteractiveMeta, RuntimeConfig } from "./types.js";

const interactiveSubsessions: InteractiveSubsessions = {};
let isStoreLoaded = false;

async function loadStore(cwd: string) {
  if (isStoreLoaded) return;

  const filePath = getPiPath("subsessions", cwd);
  const persistedStore = await readJson<InteractiveSubsessions>(filePath, {});

  for (const [parentId, subsessions] of Object.entries(persistedStore)) {
    interactiveSubsessions[parentId] = subsessions;
  }

  isStoreLoaded = true;
}

async function persistStore(cwd: string) {
  const filePath = getPiPath("subsessions", cwd);
  await writeJson(filePath, interactiveSubsessions);
}

export async function findSubsession(
  parentId: string,
  id: string,
): Promise<InteractiveMeta | null> {
  await loadStore(process.cwd());

  const parentSubsessions = interactiveSubsessions[parentId];
  if (!parentSubsessions) return null;

  return parentSubsessions[id] ?? null;
}

export async function saveSubsession(parentId: string, id: string, entry: InteractiveMeta) {
  await loadStore(process.cwd());

  if (!interactiveSubsessions[parentId]) {
    interactiveSubsessions[parentId] = {};
  }

  interactiveSubsessions[parentId]![id] = entry;
  await persistStore(process.cwd());
}

export async function deleteSubsession(parentId: string, id: string) {
  await loadStore(process.cwd());

  const parentSubsessions = interactiveSubsessions[parentId];
  if (!parentSubsessions || !parentSubsessions[id]) {
    return;
  }

  delete parentSubsessions[id];
  if (Object.keys(parentSubsessions).length === 0) {
    delete interactiveSubsessions[parentId];
  }

  await persistStore(process.cwd());
}

export async function resolveRuntime(name: string, model?: string): Promise<RuntimeConfig> {
  const [agent] = await loadAgents(process.cwd(), name);
  return { systemPrompt: agent.body, tools: agent.meta.tools, modelId: agent.meta.model ?? model };
}
