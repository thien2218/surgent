import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { StoredSubsessions, SubsessionMeta, RuntimeConfig } from "./types.js";
import { unlink } from "node:fs/promises";

const STORE_FILE = getPiPath("subsessions", process.cwd());
const subsessions: StoredSubsessions = {};
let isStoreLoaded = false;

export function getSubsessionDir(cwd: string): string {
  return getPiPath("subsessionsDir", cwd);
}

export function getSubsessionDirs(cwd: string): string[] {
  const projectDir = getSubsessionDir(cwd);
  const legacyDir = getPiPath("subsessionsDir");
  return projectDir === legacyDir ? [projectDir] : [projectDir, legacyDir];
}

export async function findSubsessionSession(cwd: string, id: string) {
  for (const sessionDir of getSubsessionDirs(cwd)) {
    try {
      const sessions = await SessionManager.list(cwd, sessionDir);
      const session = sessions.find((item) => item.id === id);
      if (session) return { path: session.path, sessionDir };
    } catch {
      continue;
    }
  }
}

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

export async function loadSubsessionOutput(cwd: string, id: string): Promise<string> {
  try {
    const session = await findSubsessionSession(cwd, id);
    if (!session) return "";

    const sessionManager = SessionManager.open(session.path, session.sessionDir, cwd);
    const branchEntries = sessionManager.getBranch();

    for (let entryIndex = branchEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const branchEntry = branchEntries[entryIndex];
      if (!branchEntry || branchEntry.type !== "message") continue;

      const message = branchEntry.message;
      if (message.role !== "assistant") continue;

      for (let idx = message.content.length - 1; idx >= 0; idx -= 1) {
        const contentPart = message.content[idx] as { type?: unknown; text?: unknown };
        if (contentPart.type === "text" && typeof contentPart.text === "string") {
          return contentPart.text;
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

export async function terminateSubsession(cwd: string, id: string) {
  await loadStore();
  delete subsessions[id];
  await writeJson(STORE_FILE, subsessions);

  const session = await findSubsessionSession(cwd, id);
  if (!session) return;
  await unlink(session.path);
}

export async function resolveRuntime(name: string, model?: string): Promise<RuntimeConfig> {
  const [agent] = await loadAgents(process.cwd(), name);
  return {
    agentMeta: agent.meta,
    systemPrompt: agent.body,
    tools: agent.meta.tools,
    modelId: agent.meta.model ?? model,
    thinkingLevel: agent.meta.thinking_level,
  };
}
