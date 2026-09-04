import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadAgents } from "../agent/storage.js";
import { getPiPath, readJson, writeJson } from "../utils.js";
import type { StoredSubsessions, RuntimeConfig, Subsession } from "./types.js";
import { unlink } from "node:fs/promises";

const MARKDOWN_HEADING_PATTERN = /^\s*#\s+(.+?)\s*$/m;

function extractSubsessionTitle(output: string): string | undefined {
  const headingMatch = output.match(MARKDOWN_HEADING_PATTERN);
  if (!headingMatch) return;

  const headingText = headingMatch[1]?.trim();
  if (!headingText) return;

  const separatorIdx = headingText.indexOf(":");
  const title = separatorIdx >= 0 ? headingText.slice(separatorIdx + 1).trim() : headingText;
  if (!title) return;

  return title;
}

export async function findSubsessionFile(cwd: string, id: string) {
  const dir = getPiPath("subsessionsDir", cwd);
  const sessions = await SessionManager.list(cwd, dir);
  const session = sessions.find((item) => item.id === id);
  if (session) return { path: session.path, dir };
}

async function loadStore(cwd: string) {
  return readJson<StoredSubsessions>(getPiPath("subsessions", cwd), {});
}

export async function findSubsession(cwd: string, id?: string, pid?: string) {
  if (!id) return null;
  const subsessions = await loadStore(cwd);
  const found = subsessions[id];
  if (!found || (pid && found.pid !== pid)) return null;
  return found;
}

export async function saveSubsession(cwd: string, subsession: Subsession) {
  if (!subsession.result.id || subsession.label === "subagent") return;
  if (!subsession.title && subsession.result.status === "done") {
    subsession.title = extractSubsessionTitle(subsession.result.output) ?? "Untitled";
  }

  const subsessions = await loadStore(cwd);
  subsessions[subsession.result.id] = {
    agent: subsession.runtime.agent,
    label: subsession.label,
    pid: subsession.pid,
    title: subsession.title,
    usage: subsession.result.usage,
  };
  await writeJson(getPiPath("subsessions", cwd), subsessions);
}

export async function loadSubsessionOutput(cwd: string, id: string): Promise<string> {
  try {
    const file = await findSubsessionFile(cwd, id);
    if (!file) return "";

    const sessionManager = SessionManager.open(file.path, file.dir, cwd);
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
  const subsessions = await loadStore(cwd);
  delete subsessions[id];
  await writeJson(getPiPath("subsessions", cwd), subsessions);

  const file = await findSubsessionFile(cwd, id);
  if (!file) return;
  await unlink(file.path);
}

export async function resolveRuntime(cwd: string, agent: string): Promise<RuntimeConfig> {
  const [cfg] = await loadAgents(cwd, agent);
  return { agent, meta: cfg.meta, systemPrompt: cfg.body };
}
