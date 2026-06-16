import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { InteractiveSubsessions, InteractiveMeta, RuntimeConfig } from "./types.js";

const interactiveSubsessions: InteractiveSubsessions = {};
let isStoreLoaded = false;

async function loadStore(cwd: string): Promise<void> {
  if (isStoreLoaded) return;

  const filePath = getPiPath("subsessions", cwd);
  const persistedStore = await readJson<InteractiveSubsessions>(filePath, {});

  for (const [parentId, subsessions] of Object.entries(persistedStore)) {
    interactiveSubsessions[parentId] = subsessions;
  }

  isStoreLoaded = true;
}

async function persistStore(cwd: string): Promise<void> {
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

export async function saveSubsession(
  parentId: string,
  id: string,
  entry: InteractiveMeta,
): Promise<void> {
  await loadStore(process.cwd());

  if (!interactiveSubsessions[parentId]) {
    interactiveSubsessions[parentId] = {};
  }

  interactiveSubsessions[parentId]![id] = entry;
  await persistStore(process.cwd());
}

export async function resolveRuntime(name: string): Promise<RuntimeConfig> {
  const [agent] = await loadAgents(process.cwd(), name);
  return { systemPrompt: agent.body, tools: agent.meta.tools, modelId: agent.meta.model };
}
